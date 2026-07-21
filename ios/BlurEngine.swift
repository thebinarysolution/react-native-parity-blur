import Foundation
import Metal
import MetalPerformanceShaders
import UIKit

/// Process-wide blur engine (plan §15.1, §26, §27).
///
/// Created LAZILY the first time an eligible blur view actually needs blur resources — never at
/// module load, package link, or view init. Reduce-Transparency fallback instances and views
/// that never reach an eligible capture state must never call `BlurEngine.shared()`.
final class BlurEngine {

  private static var _shared: BlurEngine?
  static var isInitialized: Bool { _shared != nil }

  /// Lazy accessor. Returns nil when Metal is unavailable (the caller falls back to
  /// fallbackColor rendering — plan §25/§27 fallback instances allocate nothing).
  static func shared() -> BlurEngine? {
    if let s = _shared { return s }
    guard let device = MTLCreateSystemDefaultDevice(),
          let queue = device.makeCommandQueue() else {
      return nil
    }
    let s = BlurEngine(device: device, queue: queue)
    _shared = s
    ParityBlurDebug.log("engine-init")
    return s
  }

  let device: MTLDevice
  let queue: MTLCommandQueue

  /// MPS gaussian kernel cache keyed by sigma quantized to 1/16 (bounds cache size; a 1/16-px
  /// sigma step is far below visible threshold). Cleared on memory pressure.
  private var kernelCache: [Int: MPSImageGaussianBlur] = [:]

  /// Compiled post-process pipeline (crop + saturation + overlay — ColorPipeline.swift).
  /// A RENDER pipeline (fullscreen triangle → fragment) that writes the drawable as a render
  /// target; a compute kernel writing the bgra8Unorm drawable is dropped on some GPUs (A13).
  private var postPipeline: MTLRenderPipelineState?
  private var linearSampler: MTLSamplerState?

  /// Per-window contexts, weakly keyed so they die with their window (plan §15.2, §26).
  private let windowContexts = NSMapTable<UIWindow, WindowBlurContext>.weakToStrongObjects()

  private var memoryWarningObserver: NSObjectProtocol?

  private init(device: MTLDevice, queue: MTLCommandQueue) {
    self.device = device
    self.queue = queue
    memoryWarningObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didReceiveMemoryWarningNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.handleMemoryWarning()
    }
  }

  func gaussian(sigma: Float) -> MPSImageGaussianBlur {
    let key = max(1, Int((sigma * 16).rounded()))
    if let k = kernelCache[key] { return k }
    let k = MPSImageGaussianBlur(device: device, sigma: Float(key) / 16.0)
    k.edgeMode = .clamp // spec §5: CLAMP on the clamped outer boundary, both platforms
    kernelCache[key] = k
    return k
  }

  /// Lazily compiled render pipeline for the post pass. Returns nil on compile failure
  /// (callers fall back to a plain blit — blur-only, no saturation/overlay — and log once).
  /// The color attachment is `.bgra8Unorm` to match the CAMetalLayer drawable.
  func postProcessPipeline() -> MTLRenderPipelineState? {
    if let p = postPipeline { return p }
    do {
      let library = try device.makeLibrary(source: ColorPipeline.metalSource, options: nil)
      guard let vfn = library.makeFunction(name: "parityblur_vtx"),
            let ffn = library.makeFunction(name: "parityblur_frag") else { return nil }
      let desc = MTLRenderPipelineDescriptor()
      desc.vertexFunction = vfn
      desc.fragmentFunction = ffn
      desc.colorAttachments[0].pixelFormat = .bgra8Unorm
      let p = try device.makeRenderPipelineState(descriptor: desc)
      postPipeline = p
      return p
    } catch {
      NSLog("[ParityBlur] post-process render pipeline compile failed: %@", "\(error)")
      return nil
    }
  }

  func sampler() -> MTLSamplerState? {
    if let s = linearSampler { return s }
    let desc = MTLSamplerDescriptor()
    desc.minFilter = .linear
    desc.magFilter = .linear // spec §3.4/§9.12: bilinear resolves the fractional crop origin
    desc.sAddressMode = .clampToEdge
    desc.tAddressMode = .clampToEdge
    linearSampler = device.makeSamplerState(descriptor: desc)
    return linearSampler
  }

  func windowContext(for window: UIWindow) -> WindowBlurContext {
    if let ctx = windowContexts.object(forKey: window) { return ctx }
    let ctx = WindowBlurContext()
    windowContexts.setObject(ctx, forKey: window)
    return ctx
  }

  private func handleMemoryWarning() {
    // Plan §26: trim caches; per-view snapshot buffers are trimmed by their owners via this
    // same notification. Kernels and the pipeline recompile/reallocate lazily on next use.
    kernelCache.removeAll()
  }
}
