package com.parityblur

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.ViewGroup
import java.util.Collections
import java.util.WeakHashMap
import kotlin.math.max

/**
 * Marker for software (in-tree) capture passes (plan §14.2; M0-REPORT finding 1).
 *
 * A software [Canvas] makes [ViewGroup] call each child's `draw(Canvas)`, where
 * [ParityBlurView]'s override can bail out for the duration of the pass. On the HARDWARE path
 * `ViewGroup.dispatchDraw` instead records a LIVE REFERENCE to each child's RenderNode without
 * ever calling `draw(Canvas)` -- a draw-override exclusion is invisible there, and an in-tree
 * RenderNode capture forms a reference cycle that crashes the RenderThread (SIGSEGV,
 * device-verified in M0 on a Pixel 6a). Static v1 therefore captures ONLY via this software
 * provider (plan §14.1 amendment); a structural (RenderNode) live provider is Milestone 6 scope
 * and requires the blur view to sit OUTSIDE the captured subtree by construction.
 */
object CapturePass {
  @Volatile
  var active: Boolean = false
    private set

  /** Every registered ParityBlurView presentation surface bails out of draw() during a pass. */
  val registered: MutableSet<ParityBlurView> = Collections.newSetFromMap(WeakHashMap())

  fun <T> run(block: () -> T): T {
    check(!active) { "nested capture pass" }
    active = true
    try {
      return block()
    } finally {
      active = false
    }
  }
}

/**
 * The static-mode capture provider (plan §14.1 as amended by M0-REPORT): rasterize the capture
 * target into a downsampled ARGB_8888 bitmap via a software Canvas (draw-override exclusion
 * works there; no RenderNode references exist, so no cycle is possible), producing a frozen
 * copy -- true static semantics. GPU blur/saturation are applied afterward by the caller via a
 * RenderNode carrying a RenderEffect chain on the resulting bitmap
 * ([ParityBlurView.presentCapture]).
 */
object SoftwareSnapshotProvider {

  /** Everything [ParityBlurView] needs to build/refresh its presentation RenderNode. */
  class Result(
    val bitmap: Bitmap,
    val cropRect: PipelineMath.Rect,
    val downsample: Int,
    val noBlur: Boolean,
    val radiusPlatform: Float
  )

  /**
   * Capture [target] cropped/expanded around [view]'s current on-screen bounds (pipeline steps
   * 1-7, PIPELINE_SPEC §9) and return a downsampled bitmap plus the crop rect needed to present
   * just the visible region back out. Returns null when the view/target are not presently in a
   * capturable state -- callers gate this behind [ParityBlurView]'s state machine (plan §14.4),
   * but this function re-checks defensively since it is the last word before allocating a bitmap.
   */
  /**
   * The geometry every provider shares (PIPELINE_SPEC §3): identical math regardless of HOW the
   * pixels are captured, so provider choice can never change blur geometry.
   */
  internal class Plan(
    val snapshotRect: PipelineMath.Rect,
    val cropRect: PipelineMath.Rect,
    val downsample: Int,
    val snapW: Int,
    val snapH: Int,
    val targetLocX: Int,
    val targetLocY: Int,
    val noBlur: Boolean,
    val radiusPlatform: Float
  )

  internal fun computePlan(
    view: ParityBlurView,
    target: ViewGroup,
    blurRadiusDp: Double,
    downsampleProp: Int,
    quality: String
  ): Plan? {
    if (!view.isAttachedToWindow || view.width <= 0 || view.height <= 0) return null
    if (target.width <= 0 || target.height <= 0) return null

    val density = view.resources.displayMetrics.density.toDouble()
    val sigmaPx = PipelineMath.sigmaPxFromDp(blurRadiusDp, density)

    val viewLoc = IntArray(2)
    val targetLoc = IntArray(2)
    view.getLocationInWindow(viewLoc)
    target.getLocationInWindow(targetLoc)
    // Target-local device px. getLocationInWindow() already reflects ancestor scroll offsets and
    // transforms applied up to the window, so no separate scroll-offset bookkeeping is needed
    // (plan §18 coordinate conversion: view -> window -> target-local).
    val visibleRect = PipelineMath.Rect(
      x = (viewLoc[0] - targetLoc[0]).toDouble(),
      y = (viewLoc[1] - targetLoc[1]).toDouble(),
      width = view.width.toDouble(),
      height = view.height.toDouble()
    )
    val targetBounds = PipelineMath.Rect(0.0, 0.0, target.width.toDouble(), target.height.toDouble())

    val captureRectPx = PipelineMath.expandCaptureRect(visibleRect, targetBounds, sigmaPx)
    ParityBlurDebug.log {
      "[${System.identityHashCode(view)}] plan view=${view.width}x${view.height} " +
        "viewLoc=(${viewLoc[0]},${viewLoc[1]}) target=${target.width}x${target.height} " +
        "targetLoc=(${targetLoc[0]},${targetLoc[1]}) " +
        "visible=(${visibleRect.x},${visibleRect.y},${visibleRect.width},${visibleRect.height}) " +
        "capture=(${captureRectPx.x},${captureRectPx.y},${captureRectPx.width},${captureRectPx.height}) " +
        "sigmaPx=$sigmaPx density=$density"
    }
    if (captureRectPx.width <= 0 || captureRectPx.height <= 0) {
      ParityBlurDebug.log {
        "[${System.identityHashCode(view)}] plan -> NULL: capture rect is empty, i.e. the view is " +
          "entirely OUTSIDE the capture target. Nothing to capture."
      }
      return null
    }

    val downsample = PipelineMath.resolveDownsample(
      downsampleProp,
      sigmaPx,
      PipelineMath.rectArea(captureRectPx),
      quality
    )
    val snapshotRect = PipelineMath.snapshotRectFor(captureRectPx, downsample)
    val cropRect = PipelineMath.cropRectFor(visibleRect, snapshotRect, downsample)
    val sigmaSnapshot = PipelineMath.sigmaSnapshotFromPx(sigmaPx, downsample)
    val blurParam = AndroidBlurCalibration.radiusForSigma(sigmaSnapshot)

    return Plan(
      snapshotRect = snapshotRect,
      cropRect = cropRect,
      downsample = downsample,
      snapW = max(1, snapshotRect.width.toInt()),
      snapH = max(1, snapshotRect.height.toInt()),
      targetLocX = targetLoc[0],
      targetLocY = targetLoc[1],
      noBlur = blurParam.noBlur,
      radiusPlatform = blurParam.radiusPlatform.toFloat()
    )
  }

  fun capture(
    view: ParityBlurView,
    target: ViewGroup,
    blurRadiusDp: Double,
    downsampleProp: Int,
    quality: String,
    engine: BlurEngine
  ): Result? {
    val plan = computePlan(view, target, blurRadiusDp, downsampleProp, quality) ?: return null
    val snapshotRect = plan.snapshotRect
    val cropRect = plan.cropRect
    val downsample = plan.downsample
    val snapW = plan.snapW
    val snapH = plan.snapH

    val bitmap = engine.acquireBitmap(snapW, snapH)
    val softCanvas = Canvas(bitmap)
    // LOCKED rounding rule (PIPELINE_SPEC §3.3): the snapshot origin is FLOORED, so the canvas
    // must translate by the floored*D device-px origin -- NOT the raw (possibly fractional)
    // capture-rect origin -- to keep the bitmap's pixel (0,0) aligned with snapshotRect (0,0).
    softCanvas.scale(1f / downsample, 1f / downsample)
    softCanvas.translate(
      (-(snapshotRect.x * downsample)).toFloat(),
      (-(snapshotRect.y * downsample)).toFloat()
    )
    CapturePass.run { target.draw(softCanvas) }

    return Result(
      bitmap = bitmap,
      cropRect = cropRect,
      downsample = downsample,
      noBlur = plan.noBlur,
      radiusPlatform = plan.radiusPlatform
    )
  }
}
