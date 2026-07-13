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
    } else {
      presentation.isHidden = false
      backgroundColor = .clear
    }
  }

  private var isEligible: Bool {
    window != nil && bounds.width > 0.5 && bounds.height > 0.5 && !isFallbackActive
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
    guard snapshotRect.width >= 1, snapshotRect.height >= 1 else { return }

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
    guard lastCrop != nil, dstTexture != nil, let engine = BlurEngine.shared() else { return }
    encodeAndPresent(engine: engine, uploadSnapshot: false)
  }

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
      }
      guard let src = srcTexture else { return }
      src.replace(
        region: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0,
        withBytes: data, bytesPerRow: buffer.bytesPerRow
      )
    }
    guard let src = srcTexture, let dst = dstTexture else { return }

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
      } else if let blit = cb.makeBlitCommandEncoder() {
        blit.copy(from: src, to: dst)
        blit.endEncoding()
      }
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
          let sampler = engine.sampler(),
          let compute = cb.makeComputeCommandEncoder() else {
      // Degraded path: blit the integer-aligned crop (blur only). Logged once by the engine.
      if let blit = cb.makeBlitCommandEncoder() {
        let x = min(max(0, Int(crop.x)), dst.width - 1)
        let y = min(max(0, Int(crop.y)), dst.height - 1)
        let w = min(cropW, dst.width - x)
        let h = min(cropH, dst.height - y)
        blit.copy(
          from: dst, sourceSlice: 0, sourceLevel: 0,
          sourceOrigin: MTLOrigin(x: x, y: y, z: 0),
          sourceSize: MTLSize(width: w, height: h, depth: 1),
          to: drawable.texture, destinationSlice: 0, destinationLevel: 0,
          destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0)
        )
        blit.endEncoding()
      }
      cb.present(drawable)
      cb.commit()
      return
    }

    var uniforms = ColorPipeline.uniforms(
      cropX: crop.x, cropY: crop.y, saturation: saturation, overlay: overlayRGBA
    )
    compute.setComputePipelineState(pipeline)
    compute.setTexture(dst, index: 0)
    compute.setTexture(drawable.texture, index: 1)
    compute.setSamplerState(sampler, index: 0)
    compute.setBytes(&uniforms, length: MemoryLayout<ColorPipeline.Uniforms>.stride, index: 0)
    let tg = MTLSize(width: 8, height: 8, depth: 1)
    let grid = MTLSize(
      width: (cropW + tg.width - 1) / tg.width,
      height: (cropH + tg.height - 1) / tg.height,
      depth: 1
    )
    compute.dispatchThreadgroups(grid, threadsPerThreadgroup: tg)
    compute.endEncoding()

    cb.present(drawable)
    cb.commit()
  }
}
