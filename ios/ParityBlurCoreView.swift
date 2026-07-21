import Metal
import MetalPerformanceShaders
import UIKit

/// The UIKit core of ParityBlurView (plan §15, §20, §36 iOS counterpart = plan §37).
///
/// Owned by the Fabric component view (ParityBlurView.mm) as its contentView; children mount
/// ABOVE it, so they stay sharp (plan §30). Static mode only in this milestone: capture once on
/// each trigger (attach, layout/size change, pipeline-prop change, refresh()), coalesced per
/// window; mode='live' renders like static until the shared live coordinator lands (plan §39).
///
/// Pipeline per capture (spec §9): PipelineMath geometry (device px, locked rounding) →
/// LayerRenderSnapshotProvider (model-state, registry exclusion, clipped, downsampled,
/// sRGB-encoded BGRA8) → upload to .bgra8Unorm texture (gamma-space domain, spec §6) →
/// MPSImageGaussianBlur(.clamp) → compute post pass (bilinear fractional crop + saturation
/// matrix + overlay source-over) → CAMetalLayer drawable (no readback).
@objc(ParityBlurCoreView)
public final class ParityBlurCoreView: UIView {

  // MARK: - Props (set by ParityBlurView.mm)

  @objc public var blurRadius: Double = 0 {
    didSet { if blurRadius != oldValue { requestCapture() } }
  }
  @objc public var mode: NSString = "static" {
    didSet {
      guard mode != oldValue else { return }
      syncLiveRegistration()
      if mode == "static" { requestCapture() } // leaving live: freeze on a fresh static capture
    }
  }
  @objc public var saturation: Double = 1 {
    didSet { if saturation != oldValue { representOnly() } }
  }
  @objc public var overlayColor: UIColor? {
    didSet { representOnly() }
  }
  @objc public var quality: NSString = "balanced" {
    didSet { if quality != oldValue { requestCapture() } }
  }
  /// 0 = 'auto' sentinel (ParityBlurViewNativeComponent.ts).
  @objc public var downsample: Int = 0 {
    didSet { if downsample != oldValue { requestCapture() } }
  }
  @objc public var maxFps: Int = 30 // stored; live scheduler is M6 scope
  @objc public var fallbackColor: UIColor? {
    didSet { applyFallbackStateIfNeeded() }
  }

  @objc public func setCornerRadii(
    topLeft: Double, topRight: Double, bottomRight: Double, bottomLeft: Double
  ) {
    presentation.setCornerRadii(
      topLeft: topLeft, topRight: topRight,
      bottomRight: bottomRight, bottomLeft: bottomLeft
    )
  }

  /// Fabric `refresh()` command (plan §29): coalesced recapture on the next runloop turn.
  @objc public func refresh() {
    requestCapture()
  }

  // MARK: - Internals

  private let presentation = MetalPresentationView()
  private let provider: SnapshotProvider = LayerRenderSnapshotProvider()

  private var srcTexture: MTLTexture?
  private var dstTexture: MTLTexture?
  /// Post-pass inputs kept for saturation/overlay re-present without recapture (plan §20).
  private var lastCrop: PipelineMath.Rect?
  private var lastSigmaSnapshot: Double = 0

  private var generation: UInt64 = 0
  private var windowContext: WindowBlurContext?
  private var lastSize = CGSize.zero
  private var observers: [NSObjectProtocol] = []

  public override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    presentation.isUserInteractionEnabled = false
    addSubview(presentation)
    BlurSurfaceRegistry.shared.register(self)

    observers.append(NotificationCenter.default.addObserver(
      forName: UIAccessibility.reduceTransparencyStatusDidChangeNotification,
      object: nil, queue: .main
    ) { [weak self] _ in
      self?.applyFallbackStateIfNeeded()
      // §25: fully release blur machinery when RT turns on — not just skip work. Without this
      // the live view stays registered and the shared CADisplayLink keeps ticking idly.
      self?.syncLiveRegistration()
      self?.requestCapture()
    })
    observers.append(NotificationCenter.default.addObserver(
      forName: UIApplication.didReceiveMemoryWarningNotification,
      object: nil, queue: .main
    ) { [weak self] _ in
      // Plan §26: transient CPU snapshot buffers are droppable; textures stay (they present
      // the current static frame). The buffer reallocates on the next capture.
      (self?.provider.buffer)?.release()
    })
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("unavailable") }

  deinit {
    for o in observers { NotificationCenter.default.removeObserver(o) }
  }

  // MARK: - Lifecycle (plan §14.4-equivalent state machine, §20 triggers, §27 laziness)

  public override func layoutSubviews() {
    super.layoutSubviews()
    presentation.frame = bounds
    sendSubviewToBack(presentation)
    if bounds.size != lastSize {
      lastSize = bounds.size
      requestCapture()
    }
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if let window {
      guard !isFallbackActive, BlurEngine.shared() != nil else {
        applyFallbackStateIfNeeded()
        return
      }
      let ctx = BlurEngine.shared()!.windowContext(for: window)
      ctx.register(self)
      windowContext = ctx
      requestCapture()
      syncLiveRegistration()
    } else {
      windowContext?.unregister(self)
      windowContext = nil
      ParityBlurDebug.log("instance-release id=\(ObjectIdentifier(self)) mode=\(mode)")
    }
  }

  /// Milestone 6: live views register with the per-window coordinator (plan §21/§39).
  private func syncLiveRegistration() {
    guard let ctx = windowContext else { return }
    if mode == "live", window != nil, !isFallbackActive {
      ctx.registerLive(self)
    } else {
      ctx.unregisterLive(self)
    }
  }

  private var isFallbackActive: Bool {
    UIAccessibility.isReduceTransparencyEnabled
  }

  /// Reduce Transparency (plan §25): render fallbackColor, run no blur machinery.
  private func applyFallbackStateIfNeeded() {
    if isFallbackActive {
      presentation.isHidden = true
      backgroundColor = fallbackColor ?? .clear
      warnReduceTransparencyOnce()
    } else {
      presentation.isHidden = false
      backgroundColor = .clear
    }
  }

  private var warnedReduceTransparency = false

  /// The single most confusing "it works in the simulator but not on my phone" report there is:
  /// Reduce Transparency is OFF by default in the simulator and commonly ON for real users, so the
  /// device silently renders a FLAT `fallbackColor` fill where the simulator renders a real blur.
  /// Nobody guesses this from the screen -- a solid rectangle just looks like a broken library --
  /// so it is announced unconditionally, exactly once per view.
  private func warnReduceTransparencyOnce() {
    guard !warnedReduceTransparency else { return }
    warnedReduceTransparency = true
    ParityBlurDebug.warnOnce(
      "iOS \"Reduce Transparency\" is ENABLED on this device, so this BlurView is intentionally "
        + "rendering its flat fallbackColor (\(fallbackColor.map { "\($0)" } ?? "transparent")) "
        + "instead of a real blur. This is the documented accessibility behaviour, not a bug -- but "
        + "it is why the simulator (where the setting defaults to OFF) blurs and this device does "
        + "not. Turn it off in Settings > Accessibility > Display & Text Size > Reduce Transparency, "
        + "or pick a fallbackColor that looks acceptable as a solid fill."
    )
  }

  private var isEligible: Bool {
    window != nil && bounds.width > 0.5 && bounds.height > 0.5 && !isFallbackActive
  }

  /// Origin at the last DEFERRED capture attempt (the settle gate's previous sample); nil when the
  /// view is not currently being polled for settling.
  private var lastSettleOrigin: CGPoint?

  /// Last window origin seen by the settle poll; nil = never sampled.
  private var lastWatchedOrigin: CGPoint?

  private var warnedNoBlur = false
  private var warnedDegraded = false

  /// The compute post-process pipeline was unavailable AND the fallback blit could not cover the
  /// whole drawable. Loud and unconditional: this is the state that used to render solid magenta,
  /// and a silent skip would just look like "the blur froze".
  private func warnDegradedPresentSkippedOnce(covers: Bool, w: Int, h: Int, cw: Int, ch: Int) {
    guard !warnedDegraded else { return }
    warnedDegraded = true
    ParityBlurDebug.warnOnce(
      "post-process compute pipeline unavailable on this device, and the fallback blit "
        + (covers ? "encoder could not be created" : "covers only \(w)x\(h) of a \(cw)x\(ch) drawable")
        + ". Skipping the present rather than showing undefined GPU memory (which renders as solid "
        + "magenta on device). The blur will hold its previous frame. Please report this with your "
        + "device model and iOS version — see docs/DIAGNOSTICS.md."
    )
  }

  /// blurRadius resolving to "no blur" means we faithfully present the captured snapshot 1:1 --
  /// which on screen is INDISTINGUISHABLE from the library doing nothing ("pure passthrough").
  /// If the app asked for a real blur, the prop almost certainly never reached native.
  private func warnNoBlurOnce() {
    guard !warnedNoBlur else { return }
    warnedNoBlur = true
    ParityBlurDebug.warnOnce(
      "blurRadius=\(blurRadius) resolves to NO BLUR, so the captured backdrop is presented "
        + "unblurred (this looks exactly like pass-through). If you passed a non-zero blurRadius, "
        + "the prop is not reaching native -- check that codegen ran for your React Native version."
    )
  }

  /// Would a capture right now be CLAMPED by the target bounds -- i.e. does any part of this view
  /// lie outside the window? `expandCaptureRect` intersects with the target, so such a capture only
  /// covers the overlapping band while the view still needs its full extent.
  private func captureWouldClamp(in window: UIWindow) -> Bool {
    let scale = Double(window.screen.scale)
    let f = convert(bounds, to: window)
    return f.minX < 0 || f.minY < 0
      || Double(f.maxX) * scale > Double(window.bounds.width) * scale
      || Double(f.maxY) * scale > Double(window.bounds.height) * scale
  }

  /**
   Per-frame geometry check driven by `WindowBlurContext`'s settle poll (plan §18). Returns whether
   polling should CONTINUE.

   `layoutSubviews` fires only on a `bounds.size` change, so an ancestor TRANSFORM -- what every
   sheet/modal transition animates -- is invisible to every other trigger, while
   `convert(bounds, to: window)` (which the capture plan is built from) does reflect it. Without
   this, a backdrop that captured a clamped band mid-animation keeps it forever.

   Polling continues only while the view is still CLAMPED, i.e. while its presented result is known
   to be degraded. The moment it settles fully inside the window and re-captures cleanly, the poll
   stops and the link tears down -- so a settled window keeps zero display links.
   */
  func checkWindowGeometry() -> Bool {
    guard mode as String == "static", isEligible, let window else { return false }
    let origin = convert(bounds, to: window).origin
    if origin != lastWatchedOrigin {
      lastWatchedOrigin = origin
      requestCapture()
    }
    return captureWouldClamp(in: window)
  }

  private func requestCapture() {
    guard isEligible else { return }
    generation &+= 1
    guard let window else { return }
    let ctx = windowContext ?? BlurEngine.shared().map { engine in
      let c = engine.windowContext(for: window)
      c.register(self)
      windowContext = c
      return c
    }
    ctx?.scheduleCapture(self)
  }

  // MARK: - Capture + render (invoked by WindowBlurContext on the main runloop)

  func performScheduledCapture() {
    guard isEligible, let window, let engine = BlurEngine.shared() else { return }
    let myGeneration = generation
    let target: UIView = window // default target (plan §18); blurTarget override is a later milestone

    let scale = Double(window.screen.scale)
    let sigmaPx = PipelineMath.sigmaPxFromDp(blurRadius, displayScale: scale)

    // Geometry in target-local DEVICE PX (spec §3).
    let framePt = convert(bounds, to: target)
    let visible = PipelineMath.Rect(
      x: framePt.minX * scale, y: framePt.minY * scale,
      width: framePt.width * scale, height: framePt.height * scale
    )
    let targetBounds = PipelineMath.Rect(
      x: 0, y: 0,
      width: target.bounds.width * scale, height: target.bounds.height * scale
    )
    // Settle gate (plan §18): never BAKE a capture that the target bounds would clamp while the
    // view is still moving. A sheet/modal host animating a transform drags this view partly outside
    // the window; expandCaptureRect then clamps the capture to a band, and in static mode that band
    // is what gets frozen -- permanently, because layoutSubviews only fires on a bounds.SIZE change
    // and a transform changes neither size nor bounds. Poll instead until the motion stops.
    //
    // Gated on `clamped &&` deliberately: a view fully inside the target captures immediately, so
    // the common case is never delayed. A view that is legitimately half-offscreen and STATIONARY
    // also captures on its next attempt, because its origin then matches the previous sample --
    // no frame budget, no magic number, and no way to stall forever.
    let clamped = visible.x < 0 || visible.y < 0
      || visible.x + visible.width > targetBounds.width
      || visible.y + visible.height > targetBounds.height
    if clamped {
      // Keep polling regardless: a clamped view is in a known-degraded state, and the poll is the
      // ONLY thing that will notice it later settling into full view (see checkWindowGeometry).
      windowContext?.scheduleSettlePoll(self)
      let origin = CGPoint(x: framePt.minX, y: framePt.minY)
      if origin != lastSettleOrigin {
        // Still moving -- do not bake a band that this frame's transform happens to produce.
        lastSettleOrigin = origin
        return
      }
      // Stationary but clamped: capture the best band available now (better than nothing), and the
      // poll above stays armed so a later settle still upgrades it to a full, correct capture.
    } else {
      lastSettleOrigin = nil
    }

    let captureRect = PipelineMath.expandCaptureRect(
      visible: visible, targetBounds: targetBounds, sigmaPx: sigmaPx
    )
    guard captureRect.width > 0, captureRect.height > 0 else { return }

    let d = PipelineMath.resolveDownsample(
      prop: downsample, sigmaPx: sigmaPx,
      captureAreaPx: PipelineMath.rectArea(captureRect), quality: quality as String
    )
    let snapshotRect = PipelineMath.snapshotRectFor(captureRect, downsample: d)
    let crop = PipelineMath.cropRectFor(visible: visible, snapshotRect: snapshotRect, downsample: d)
    ParityBlurDebug.log(
      "[\(ObjectIdentifier(self))] plan view=\(bounds.size) scale=\(scale) mode=\(mode) "
        + "blurRadiusDp=\(blurRadius) sigmaPx=\(sigmaPx) d=\(d) "
        + "visible=(\(visible.x),\(visible.y),\(visible.width),\(visible.height)) "
        + "target=(\(targetBounds.width)x\(targetBounds.height)) "
        + "capture=(\(captureRect.x),\(captureRect.y),\(captureRect.width),\(captureRect.height)) "
        + "snapshot=(\(snapshotRect.width)x\(snapshotRect.height)) clamped=\(clamped)"
    )
    guard snapshotRect.width >= 1, snapshotRect.height >= 1 else {
      ParityBlurDebug.log("[\(ObjectIdentifier(self))] abort: snapshot rect < 1px -- nothing to capture")
      return
    }
    if blurRadius <= 0 { warnNoBlurOnce() }

    // Capture (model-state provider; registry exclusion — plan §16 rule 2: exclude ALL
    // registered surfaces, not just self).
    guard provider.capture(
      SnapshotRequest(
        target: target, snapshotRect: snapshotRect,
        downsample: d, displayScale: CGFloat(scale)
      ),
      excluding: BlurSurfaceRegistry.shared.all
    ) else { return }

    guard myGeneration == generation else { return } // stale (spec §10)

    lastCrop = crop
    lastSigmaSnapshot = PipelineMath.sigmaSnapshotFromPx(sigmaPx, downsample: d)
    encodeAndPresent(engine: engine, uploadSnapshot: true)
  }

  // ------------------------------------------------------------------- live (Milestone 6)

  private var lastLiveTick: CFTimeInterval = 0
  private var liveInFlight = false

  /// Visibility heuristic + per-view maxFps throttle + backpressure gate (plan §21, §22, §24).
  func isLiveEligible(now: CFTimeInterval) -> Bool {
    guard mode == "live", !isFallbackActive else { return false }
    guard let window, !isHidden, alpha > 0.02, bounds.width > 0.5, bounds.height > 0.5 else {
      return false
    }
    // Backpressure (plan §22): at most 1 in-flight capture+blur; latest state wins next tick.
    guard !liveInFlight else { return false }
    guard now - lastLiveTick >= 1.0 / Double(max(1, maxFps)) else { return false }
    let frameInWindow = convert(bounds, to: window)
    return frameInWindow.intersects(window.bounds)
  }

  /// One live frame: synchronous CPU snapshot + async GPU blur/present. The in-flight flag
  /// clears when the command buffer completes, dropping any ticks that arrive meanwhile
  /// (stale-frame dropping, plan §22).
  func performLiveTick(now: CFTimeInterval) {
    guard let engine = BlurEngine.shared() else { return }
    lastLiveTick = now
    liveInFlight = true
    performScheduledCapture()
    // encodeAndPresent commits asynchronously; approximate completion with the command
    // buffer's completed handler via a lightweight main-queue hop from the engine queue.
    // The capture itself is synchronous, so a conservative clear on the next runloop turn
    // still guarantees at-most-one in-flight GPU pass per view per frame.
    DispatchQueue.main.async { [weak self] in
      self?.liveInFlight = false
      _ = engine // retain engine reference through the frame
    }
  }

  /// Saturation/overlay/radius-mask changes re-present from the cached blurred texture without
  /// recapturing (plan §20). No-op until the first capture exists.
  private func representOnly() {
    guard lastCrop != nil, dstHasBlurredContent, let engine = BlurEngine.shared() else { return }
    encodeAndPresent(engine: engine, uploadSnapshot: false)
  }

  /// Whether [dstTexture] actually holds an ENCODED blur result.
  ///
  /// `dstTexture != nil` is NOT the same thing: Metal does not zero a freshly created texture, and
  /// the allocation happens before anything is encoded into it. A re-present that samples an
  /// allocated-but-never-written texture reads undefined GPU memory — harmlessly zeroed on the
  /// Simulator, but vivid garbage (commonly solid magenta) on real Apple GPUs. Device-only bug.
  private var dstHasBlurredContent = false

  private func encodeAndPresent(engine: BlurEngine, uploadSnapshot: Bool) {
    guard let crop = lastCrop else { return }
    let buffer = provider.buffer

    if uploadSnapshot {
      let w = buffer.width
      let h = buffer.height
      guard w > 0, h > 0, let data = buffer.data else { return }
      if srcTexture?.width != w || srcTexture?.height != h {
        let desc = MTLTextureDescriptor.texture2DDescriptor(
          pixelFormat: .bgra8Unorm, width: w, height: h, mipmapped: false
        )
        desc.storageMode = .shared
        desc.usage = [.shaderRead, .shaderWrite]
        srcTexture = engine.device.makeTexture(descriptor: desc)
        dstTexture = engine.device.makeTexture(descriptor: desc)
        // Freshly allocated Metal textures hold UNDEFINED memory, so the old blur result is gone
        // and nothing valid has replaced it yet. Anything that samples dst before this pass
        // finishes encoding would read garbage.
        dstHasBlurredContent = false
      }
      guard let src = srcTexture else { return }
      src.replace(
        region: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0,
        withBytes: data, bytesPerRow: buffer.bytesPerRow
      )
    }
    guard let src = srcTexture, let dst = dstTexture else { return }
    // Never sample dst unless a blur has actually been encoded into it. Without this, a re-present
    // (saturation/overlay/prop change) that lands before the first capture completes — or after a
    // resize reallocated the textures — samples undefined GPU memory: invisible on the Simulator,
    // solid magenta on device.
    if !uploadSnapshot && !dstHasBlurredContent { return }

    // Drawable sized to the crop (snapshot px); CAMetalLayer upsamples to bounds (spec §9.12).
    let cropW = max(1, Int(crop.width.rounded()))
    let cropH = max(1, Int(crop.height.rounded()))
    let ml = presentation.metalLayer
    if ml.device == nil {
      ml.device = engine.device
      ml.pixelFormat = .bgra8Unorm
      ml.framebufferOnly = false
    }
    let wanted = CGSize(width: cropW, height: cropH)
    if ml.drawableSize != wanted { ml.drawableSize = wanted }

    guard let drawable = ml.nextDrawable(),
          let cb = engine.queue.makeCommandBuffer() else { return }

    // 1. Gaussian blur (spec §9.8). No-blur clamp: sigma <= 0 presents the raw snapshot.
    let sigma = Float(lastSigmaSnapshot)
    if uploadSnapshot {
      if sigma > 0 {
        engine.gaussian(sigma: sigma).encode(commandBuffer: cb, sourceTexture: src, destinationTexture: dst)
        dstHasBlurredContent = true
      } else if let blit = cb.makeBlitCommandEncoder() {
        blit.copy(from: src, to: dst)
        blit.endEncoding()
        dstHasBlurredContent = true
      }
      // NB: set only on a branch that actually encoded work into dst. If neither ran (no blit
      // encoder), dst keeps whatever it had and stays untrusted.
    }

    // 2. Post pass: fractional crop + saturation + overlay into the drawable (spec §9.9-9.11).
    var overlayRGBA = PipelineMath.RGBA(r: 0, g: 0, b: 0, a: 0)
    if let overlayColor {
      var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
      if overlayColor.getRed(&r, green: &g, blue: &b, alpha: &a) {
        overlayRGBA = PipelineMath.RGBA(r: Double(r), g: Double(g), b: Double(b), a: Double(a))
      }
    }
    guard let pipeline = engine.postProcessPipeline(),
          let sampler = engine.sampler() else {
      // Degraded path: blit the integer-aligned crop (blur only).
      //
      // A drawable is UNDEFINED memory until something writes to it, so it must never be presented
      // unless the write covered ALL of it. Presenting a partially-written (or unwritten) drawable
      // shows raw GPU garbage — commonly solid magenta on Apple silicon, invisible on the Simulator
      // because it zeroes its pages. Skipping the present instead simply leaves the previous frame
      // on screen, which is always the better failure.
      let x = min(max(0, Int(crop.x)), max(0, dst.width - 1))
      let y = min(max(0, Int(crop.y)), max(0, dst.height - 1))
      let w = min(cropW, dst.width - x)
      let h = min(cropH, dst.height - y)
      let coversDrawable = (w == cropW && h == cropH && w > 0 && h > 0)
      if coversDrawable, let blit = cb.makeBlitCommandEncoder() {
        blit.copy(
          from: dst, sourceSlice: 0, sourceLevel: 0,
          sourceOrigin: MTLOrigin(x: x, y: y, z: 0),
          sourceSize: MTLSize(width: w, height: h, depth: 1),
          to: drawable.texture, destinationSlice: 0, destinationLevel: 0,
          destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0)
        )
        blit.endEncoding()
        cb.present(drawable)
      } else {
        warnDegradedPresentSkippedOnce(covers: coversDrawable, w: w, h: h, cw: cropW, ch: cropH)
      }
      cb.commit()
      return
    }

    var uniforms = ColorPipeline.uniforms(
      cropX: crop.x, cropY: crop.y, saturation: saturation, overlay: overlayRGBA
    )
    // Post pass as a RENDER pass writing the drawable as a render target (spec §9.9-9.11). A
    // fullscreen triangle covers every drawable pixel, so loadAction .dontCare is safe. Compute-
    // writing the bgra8Unorm drawable via texture.write is silently dropped on some Apple GPUs
    // (A13/iPhone 11 → undefined magenta); a render-target write is universally supported.
    let rpd = MTLRenderPassDescriptor()
    rpd.colorAttachments[0].texture = drawable.texture
    rpd.colorAttachments[0].loadAction = .dontCare
    rpd.colorAttachments[0].storeAction = .store
    guard let render = cb.makeRenderCommandEncoder(descriptor: rpd) else {
      // Encoder allocation failed: never present an unwritten drawable — leave the previous frame.
      cb.commit()
      return
    }
    render.setRenderPipelineState(pipeline)
    render.setFragmentTexture(dst, index: 0)
    render.setFragmentSamplerState(sampler, index: 0)
    render.setFragmentBytes(&uniforms, length: MemoryLayout<ColorPipeline.Uniforms>.stride, index: 0)
    render.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    render.endEncoding()

    cb.present(drawable)
    cb.commit()
  }
}
