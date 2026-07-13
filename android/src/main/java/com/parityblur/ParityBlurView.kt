package com.parityblur

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import android.util.Log
import android.view.View
import android.view.ViewGroup
import com.facebook.react.views.view.ReactViewGroup

/**
 * Milestone 3 static-backend implementation of ParityBlurView (docs/MASTER_PLAN.md §14, §20,
 * §36; docs/PIPELINE_SPEC.md).
 *
 * API 31+: captures the backdrop via [SoftwareSnapshotProvider] into a downsampled bitmap, then
 * presents it through a [RenderNode] carrying a chained `blur -> saturation` [RenderEffect]
 * (PIPELINE_SPEC §9 steps 7-9), with the overlay color composited on top in [onDraw] (source-over
 * on an opaque destination -- PIPELINE_SPEC §8) and rounded clipping applied to that whole
 * presentation (blur + overlay), separate from child clipping (plan §31).
 *
 * API <31: [fallbackColor] fill ONLY. Must never touch [BlurEngine] / bitmaps / RenderNode /
 * RenderEffect (plan §27, §45.1) -- every method below that reaches those is gated behind
 * [isRealBlurSupported].
 *
 * State machine (plan §14.4):
 * `DETACHED -> ATTACHED_WAITING_LAYOUT -> WAITING_STABLE_FRAME -> CAPTURE_PENDING -> CAPTURED`.
 * Capture is requested (not performed synchronously) on every trigger; the per-window
 * [WindowBlurContext] coalesces repeated requests to one capture at the next valid frame
 * (plan §45.8: never capture synchronously inside JS command dispatch, never invalidate from
 * preDraw).
 */
class ParityBlurView(context: Context) : ReactViewGroup(context) {

  private enum class CaptureState {
    DETACHED,
    ATTACHED_WAITING_LAYOUT,
    WAITING_STABLE_FRAME,
    CAPTURE_PENDING,
    CAPTURED,
  }

  // ---------------------------------------------------------------------------------- props

  var blurRadius: Double = 0.0
    private set
  var mode: String = "static"
    private set
  var overlayColor: Int? = null
    private set
  var saturation: Double = 1.0
    private set
  var quality: String = "balanced"
    private set

  /** 0 = 'auto' sentinel (see ParityBlurViewNativeComponent.ts); else 1|2|4|8. */
  var downsample: Int = 0
    private set
  var maxFps: Int = 30
    private set
  var fallbackColor: Int? = null
    private set

  fun setBlurRadius(value: Double) {
    if (value == blurRadius) return
    blurRadius = value
    debugLog { "blurRadius=$value" }
    requestCapture() // blurRadius changes the sigma -> capture region/downsample/radius (spec).
  }

  fun setMode(value: String?) {
    val next = value ?: "static"
    if (next == mode) return
    mode = next
    debugLog { "mode=$mode" }
    syncLiveRegistration()
    if (mode == "static") requestCapture() // leaving live: freeze on a fresh static capture
  }

  /** Milestone 6: live views register with the per-window coordinator (plan §21/§39). */
  private fun syncLiveRegistration() {
    if (!isRealBlurSupported()) return
    val ctx = windowContext ?: return
    if (mode == "live" && isAttachedToWindow) ctx.registerLive(this) else ctx.unregisterLive(this)
  }

  fun setOverlayColor(value: Int?) {
    overlayColor = value
    debugLog { "overlayColor=$value" }
    invalidate() // re-present without recapture (plan §20): overlay is applied at draw time only.
  }

  fun setSaturation(value: Double) {
    if (value == saturation) return
    saturation = value
    debugLog { "saturation=$value" }
    // re-present without recapture: rebuild the existing RenderNode's effect chain in place.
    if (isRealBlurSupported()) rebuildEffectChain()
    invalidate()
  }

  fun setQuality(value: String?) {
    val next = value ?: "balanced"
    if (next == quality) return
    quality = next
    debugLog { "quality=$quality" }
    requestCapture() // affects downsample selection -> recapture required (spec).
  }

  fun setDownsample(value: Int) {
    if (value == downsample) return
    downsample = value
    debugLog { "downsample=$value (0 = auto)" }
    requestCapture()
  }

  fun setMaxFps(value: Int) {
    maxFps = value.coerceIn(1, 120)
    debugLog { "maxFps=$maxFps" }
  }

  fun setFallbackColor(value: Int?) {
    fallbackColor = value
    debugLog { "fallbackColor=$value" }
    updateFallbackBackground()
  }

  /**
   * Corner radius setter invoked by [ParityBlurViewManager] (plan §31). `corner`: 0 = uniform
   * (`borderRadius`), 1 = topLeft, 2 = topRight, 3 = bottomRight, 4 = bottomLeft -- matching
   * React Native's `BorderRadiusProp` physical-corner ordering for indices 0..4. `radiusPx` is
   * already density-resolved device px, or null to clear that slot. Percentage border radii are
   * not supported for the blur-output clip in v1 (documented limitation; see manager).
   */
  fun setCornerRadiusPx(corner: Int, radiusPx: Float?) {
    when (corner) {
      0 -> uniformRadiusPx = radiusPx
      1 -> topLeftRadiusPx = radiusPx
      2 -> topRightRadiusPx = radiusPx
      3 -> bottomRightRadiusPx = radiusPx
      4 -> bottomLeftRadiusPx = radiusPx
    }
    val u = uniformRadiusPx ?: 0f
    cornerRadii = floatArrayOf(
      topLeftRadiusPx ?: u,
      topRightRadiusPx ?: u,
      bottomRightRadiusPx ?: u,
      bottomLeftRadiusPx ?: u
    )
    clipPathDirty = true
    invalidate()
  }

  /**
   * Fabric command handler for `refresh()` (plan §29): schedules a coalesced recapture on the
   * next valid frame. Never captures synchronously during command dispatch.
   */
  fun refresh() {
    debugLog { "refresh() requested" }
    requestCapture()
  }

  // --------------------------------------------------------------------- corner radii state

  private var uniformRadiusPx: Float? = null
  private var topLeftRadiusPx: Float? = null
  private var topRightRadiusPx: Float? = null
  private var bottomRightRadiusPx: Float? = null
  private var bottomLeftRadiusPx: Float? = null
  private var cornerRadii: FloatArray? = null
  private var clipPath: Path? = null
  private var clipPathDirty = true

  // -------------------------------------------------------------------------- capture target

  /**
   * Default capture target (plan §18): the window's root view. `blurTarget` ref override is not
   * wired to native in this milestone (documented gap -- see ParityBlurViewManager); the root
   * view is a reasonable default target and is guaranteed to never itself be a ParityBlurView.
   */
  private var resolvedTarget: ViewGroup? = null
  private var targetLayoutListener: View.OnLayoutChangeListener? = null

  private fun resolveTarget(): ViewGroup? {
    resolvedTarget?.let { return it }
    val target = rootView as? ViewGroup ?: return null
    val listener = View.OnLayoutChangeListener { _, l, t, r, b, ol, ot, oR, oB ->
      if ((r - l) != (oR - ol) || (b - t) != (oB - ot)) requestCapture()
    }
    target.addOnLayoutChangeListener(listener)
    resolvedTarget = target
    targetLayoutListener = listener
    return target
  }

  private fun releaseTargetListener() {
    targetLayoutListener?.let { resolvedTarget?.removeOnLayoutChangeListener(it) }
    targetLayoutListener = null
    resolvedTarget = null
  }

  // ------------------------------------------------------------------------- state machine

  private var captureState = CaptureState.DETACHED
  private var generation = 0
  private var windowContext: WindowBlurContext? = null
  private var lastLeft = Int.MIN_VALUE
  private var lastTop = Int.MIN_VALUE

  private fun isRealBlurSupported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

  private fun isEligibleForCapture(): Boolean {
    if (!isAttachedToWindow) return false
    if (width <= 0 || height <= 0) return false
    val target = resolveTarget() ?: return false
    return target.width > 0 && target.height > 0
  }

  /**
   * Request a capture: bumps the generation and asks the window context to coalesce a capture
   * at the next valid frame boundary (plan §14.4/§20/§23). No-ops entirely on API<31 (guardrail:
   * fallback-only instances must never touch BlurEngine).
   */
  private fun requestCapture() {
    if (!isRealBlurSupported()) return
    generation++
    if (!isEligibleForCapture()) {
      captureState = if (isAttachedToWindow) CaptureState.ATTACHED_WAITING_LAYOUT else CaptureState.DETACHED
      return
    }
    if (captureState != CaptureState.CAPTURED) captureState = CaptureState.WAITING_STABLE_FRAME
    val ctx = windowContext ?: BlurEngine.get(context).windowContextFor(rootView).also {
      it.register(this)
      windowContext = it
    }
    ctx.scheduleCapture(this)
  }

  /** Invoked by [WindowBlurContext]'s coalesced Choreographer callback -- runs on the main thread. */
  internal fun performScheduledCapture() {
    if (!isRealBlurSupported()) return
    if (!isEligibleForCapture()) {
      captureState = CaptureState.ATTACHED_WAITING_LAYOUT
      return
    }
    val target = resolveTarget() ?: return
    captureState = CaptureState.CAPTURE_PENDING
    val myGeneration = generation
    val engine = BlurEngine.get(context)

    // First capture after mount: GPU-composited PixelCopy so HARDWARE bitmaps (RN Images) are
    // included -- the software canvas cannot rasterize them (see PixelCopySnapshotProvider).
    // Safe only before this view has ever presented (no self-content on screen to feed back).
    // Async: generation + attachment re-validated on completion (plan §23).
    if (!hasContent) {
      PixelCopySnapshotProvider.capture(this, target, blurRadius, downsample, quality, engine) { result ->
        if (myGeneration != generation || !isAttachedToWindow) {
          result?.let { engine.releaseBitmap(it.bitmap) }
          return@capture
        }
        if (result != null) {
          presentCapture(result, engine)
          captureState = CaptureState.CAPTURED
        } else {
          // PixelCopy unavailable (no window surface, teardown race): software fallback.
          completeSoftwareCapture(target, engine, myGeneration)
        }
      }
      return
    }

    completeSoftwareCapture(target, engine, myGeneration)
  }

  // ------------------------------------------------------------------- live (Milestone 6)

  private var lastLiveCaptureNanos = 0L

  /**
   * Visibility heuristic + per-view maxFps throttle (plan §24, §21). Called by the window
   * coordinator on every pre-draw tick while any live view is registered.
   */
  internal fun isLiveEligible(nowNanos: Long): Boolean {
    if (mode != "live" || !isRealBlurSupported()) return false
    if (!isAttachedToWindow || windowVisibility != View.VISIBLE) return false
    if (!isShown || alpha <= 0.02f || width <= 0 || height <= 0) return false
    val minInterval = 1_000_000_000L / maxFps
    if (nowNanos - lastLiveCaptureNanos < minInterval) return false
    val loc = IntArray(2)
    getLocationInWindow(loc)
    val root = rootView
    if (loc[0] + width <= 0 || loc[1] + height <= 0) return false
    if (loc[0] >= root.width || loc[1] >= root.height) return false
    return true
  }

  /**
   * Live recapture INSIDE the in-flight frame (M0-proven): synchronous software capture, then
   * re-record the presentation node WITHOUT invalidate() -- the retained RenderNode propagates
   * its own damage, so no frame loop forms (plan §45.8). Software-only: PixelCopy would read
   * back this view's own committed output (feedback). Backpressure is inherent -- one capture
   * per view per frame, no queue (plan §22).
   */
  internal fun performLiveCapture(nowNanos: Long) {
    val target = resolveTarget() ?: return
    val engine = BlurEngine.get(context)
    val result = SoftwareSnapshotProvider.capture(this, target, blurRadius, downsample, quality, engine)
      ?: return
    lastLiveCaptureNanos = nowNanos
    presentCapture(result, engine, invalidateAfter = false)
    captureState = CaptureState.CAPTURED
  }

  /** Synchronous software-canvas capture (recaptures; PixelCopy fallback). */
  private fun completeSoftwareCapture(target: ViewGroup, engine: BlurEngine, myGeneration: Int) {
    val result = SoftwareSnapshotProvider.capture(this, target, blurRadius, downsample, quality, engine)
    if (myGeneration != generation) {
      result?.let { engine.releaseBitmap(it.bitmap) }
      return
    }
    if (result == null) {
      captureState = CaptureState.ATTACHED_WAITING_LAYOUT
      return
    }
    presentCapture(result, engine)
    captureState = CaptureState.CAPTURED
  }

  // ------------------------------------------------------------------------- presentation

  private var presentNode: RenderNode? = null
  private var capturedBitmap: Bitmap? = null
  private var cropRect: PipelineMath.Rect? = null
  private var capturedDownsample: Int = 1
  private var noBlurCurrent = true
  private var radiusPlatformCurrent = 0f
  private var hasContent = false

  private val overlayPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

  private fun presentCapture(
    result: SoftwareSnapshotProvider.Result,
    engine: BlurEngine,
    invalidateAfter: Boolean = true,
  ) {
    capturedBitmap?.let { old -> if (old !== result.bitmap) engine.releaseBitmap(old) }
    capturedBitmap = result.bitmap
    cropRect = result.cropRect
    capturedDownsample = result.downsample
    noBlurCurrent = result.noBlur
    radiusPlatformCurrent = result.radiusPlatform

    val node = presentNode ?: RenderNode("parityBlurPresent").also { presentNode = it }
    node.setPosition(0, 0, result.bitmap.width, result.bitmap.height)
    val recordingCanvas = node.beginRecording()
    try {
      recordingCanvas.drawBitmap(result.bitmap, 0f, 0f, null)
    } finally {
      node.endRecording()
    }
    rebuildEffectChain()
    hasContent = true
    // Live captures run inside preDraw: the re-recorded RenderNode propagates damage itself,
    // and invalidating from preDraw would schedule an infinite frame loop (plan §45.8).
    if (invalidateAfter) invalidate()
  }

  /**
   * Rebuilds the presentation node's RenderEffect chain: blur (CLAMP) then saturation
   * (PIPELINE_SPEC §9 steps 8-9), via `createColorFilterEffect(filter, blurEffect)` so saturation
   * composes AFTER blur. blurRadius=0 / no-blur clamp presents the un-blurred snapshot (spec §2)
   * by simply omitting the blur stage; overlay compositing (spec §8, the only tint) happens
   * separately in [onDraw] on top of this node's output, not inside the effect chain.
   */
  private fun rebuildEffectChain() {
    val node = presentNode ?: return
    var effect: RenderEffect? = if (!noBlurCurrent && radiusPlatformCurrent > 0f) {
      RenderEffect.createBlurEffect(radiusPlatformCurrent, radiusPlatformCurrent, Shader.TileMode.CLAMP)
    } else {
      null
    }
    if (saturation != 1.0) {
      val colorFilter = ColorMatrixColorFilter(ColorMatrix(PipelineMath.saturationMatrixFloat(saturation)))
      effect = if (effect != null) {
        RenderEffect.createColorFilterEffect(colorFilter, effect)
      } else {
        RenderEffect.createColorFilterEffect(colorFilter)
      }
    }
    node.setRenderEffect(effect)
  }

  private fun releaseCapturedResources() {
    if (isRealBlurSupported()) {
      capturedBitmap?.let { bmp -> BlurEngine.get(context).releaseBitmap(bmp) }
    }
    capturedBitmap = null
    presentNode = null
    cropRect = null
    hasContent = false
    releaseTargetListener()
  }

  // ------------------------------------------------------------------------- fallback path

  /** API<31: fallbackColor fill only. Never touches BlurEngine/bitmaps (plan §27). */
  private fun updateFallbackBackground() {
    if (isRealBlurSupported()) {
      setBackgroundColor(Color.TRANSPARENT)
    } else {
      setBackgroundColor(fallbackColor ?: Color.TRANSPARENT)
    }
  }

  // --------------------------------------------------------------------------- lifecycle

  init {
    setWillNotDraw(false)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    captureState = CaptureState.ATTACHED_WAITING_LAYOUT
    if (isRealBlurSupported()) {
      CapturePass.registered.add(this)
      val ctx = BlurEngine.get(context).windowContextFor(rootView)
      ctx.register(this)
      windowContext = ctx
      requestCapture()
      syncLiveRegistration()
    }
  }

  override fun onDetachedFromWindow() {
    captureState = CaptureState.DETACHED
    windowContext?.let {
      it.unregister(this)
      it.cancelScheduledCapture(this)
    }
    windowContext = null
    CapturePass.registered.remove(this)
    releaseCapturedResources()
    ParityBlurDebug.log { "instance-release id=${System.identityHashCode(this)} mode=$mode" }
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    clipPathDirty = true
    if (w > 0 && h > 0) requestCapture()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    val moved = left != lastLeft || top != lastTop
    lastLeft = left
    lastTop = top
    // Only treat this as a recapture trigger once we already have a captured frame -- the
    // initial layout is handled by onSizeChanged/onAttachedToWindow already scheduling one.
    if (moved && captureState == CaptureState.CAPTURED) requestCapture()
  }

  // ------------------------------------------------------------------------------- drawing

  override fun draw(canvas: Canvas) {
    // Software-path in-tree exclusion (plan §14.2; M0 finding 1): during any capture pass this
    // view contributes NOTHING -- neither its blur result nor its children -- so it can never
    // recursively capture its own (or another registered view's) presentation. Normal
    // composition (CapturePass.active == false) is unaffected: children stay sharp above the
    // blur result (plan §30).
    if (CapturePass.active) return
    super.draw(canvas)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (!isRealBlurSupported()) return // fallback path: background color only, already drawn.
    if (!hasContent || !canvas.isHardwareAccelerated) return
    val node = presentNode ?: return
    val crop = cropRect ?: return

    val saved = canvas.save()
    ensureClipPath()?.let { canvas.clipPath(it) }

    canvas.save()
    canvas.clipRect(0, 0, width, height)
    val d = capturedDownsample.toFloat()
    canvas.scale(d, d)
    canvas.translate(-crop.x.toFloat(), -crop.y.toFloat())
    canvas.drawRenderNode(node)
    canvas.restore()

    // Overlay compositing (spec §8): the ONLY tint in the pipeline. Drawing the already-parsed
    // overlayColor with a normal Paint is exactly straight-alpha source-over on the opaque
    // blurred destination beneath it -- see PipelineMath.sourceOver for the mirrored pure-math
    // form exercised by the fixture suite.
    overlayColor?.let { color ->
      if (Color.alpha(color) > 0) {
        overlayPaint.color = color
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), overlayPaint)
      }
    }

    canvas.restoreToCount(saved)
  }

  private fun ensureClipPath(): Path? {
    val radii = cornerRadii
    if (radii == null || radii.all { it <= 0f }) return null
    if (!clipPathDirty && clipPath != null) return clipPath
    val path = clipPath ?: Path().also { clipPath = it }
    path.reset()
    val rect = RectF(0f, 0f, width.toFloat(), height.toFloat())
    val r = floatArrayOf(
      radii[0], radii[0], // top-left
      radii[1], radii[1], // top-right
      radii[2], radii[2], // bottom-right
      radii[3], radii[3] // bottom-left
    )
    path.addRoundRect(rect, r, Path.Direction.CW)
    clipPathDirty = false
    return path
  }

  private inline fun debugLog(msg: () -> String) {
    if (DEBUG_LOGS) Log.d(TAG, msg())
  }

  companion object {
    private const val TAG = "ParityBlurView"
    private const val DEBUG_LOGS = false
  }
}
