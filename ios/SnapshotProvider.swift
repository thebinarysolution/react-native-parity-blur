import Foundation
import UIKit

/// Exclusion registry (plan §16): every ParityBlur presentation surface registers here and is
/// hidden at the MODEL-layer level for the duration of a capture pass, restored before the
/// runloop commits — the render server never sees the hidden state (M0-verified flicker-free;
/// presentation-layer probe measured 0 leaks).
final class BlurSurfaceRegistry {
  static let shared = BlurSurfaceRegistry()
  private let table = NSHashTable<UIView>.weakObjects()
  func register(_ v: UIView) { table.add(v) }
  func unregister(_ v: UIView) { table.remove(v) }
  var all: [UIView] { table.allObjects }
}

/// Reusable CPU snapshot buffer: BGRA8, premultiplied, sRGB-ENCODED bytes. The bytes are
/// uploaded to a non-sRGB (.bgra8Unorm) texture so the GPU convolves the encoded values —
/// gamma-space blur, matching Android/Skia (spec §6; M0 color-domain proof).
final class SnapshotBuffer {
  private(set) var width = 0
  private(set) var height = 0
  private(set) var bytesPerRow = 0
  private(set) var data: UnsafeMutableRawPointer?
  private(set) var context: CGContext?

  func ensure(width w: Int, height h: Int) -> Bool {
    guard w > 0, h > 0 else { return false }
    if w == width && h == height, context != nil { return true }
    release()
    bytesPerRow = ((w * 4 + 63) / 64) * 64
    guard let mem = malloc(bytesPerRow * h) else { return false }
    data = mem
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let info = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    guard let ctx = CGContext(
      data: mem, width: w, height: h, bitsPerComponent: 8,
      bytesPerRow: bytesPerRow, space: space, bitmapInfo: info
    ) else {
      release()
      return false
    }
    context = ctx
    width = w
    height = h
    return true
  }

  func release() {
    free(data)
    data = nil
    context = nil
    width = 0
    height = 0
    bytesPerRow = 0
  }

  deinit { free(data) }
}

/// Capture request: everything is expressed in the SNAPSHOT-PIXEL grid derived by PipelineMath
/// (spec §3): the buffer's pixel (0,0) is snapshotRect's origin, honoring the locked
/// floor-origin/ceil-far-edge rounding.
struct SnapshotRequest {
  let target: UIView
  /// Integer snapshot-pixel rect (PipelineMath.snapshotRectFor output).
  let snapshotRect: PipelineMath.Rect
  /// Downsample factor D.
  let downsample: Int
  /// Device pixels per point (UIScreen scale).
  let displayScale: CGFloat
}

/// Snapshot provider abstraction (plan §15.3). v1 ships the model-state provider as default;
/// a committed-state drawHierarchy provider can slot in later for structurally-separate targets
/// (M0: drawHierarchy renders the last committed frame and cannot honor model-layer exclusion).
protocol SnapshotProvider: AnyObject {
  var buffer: SnapshotBuffer { get }
  @discardableResult
  func capture(_ req: SnapshotRequest, excluding: [UIView]) -> Bool
}

/// Default provider (M0 finding 1): CALayer.render(in:) renders MODEL state, so registry
/// exclusion works in-tree, and the mandatory clip keeps cost proportional to the capture
/// region (M0: 4.8x cheaper with the clip).
final class LayerRenderSnapshotProvider: SnapshotProvider {
  let buffer = SnapshotBuffer()

  @discardableResult
  func capture(_ req: SnapshotRequest, excluding: [UIView]) -> Bool {
    let w = Int(req.snapshotRect.width)
    let h = Int(req.snapshotRect.height)
    guard buffer.ensure(width: w, height: h), let ctx = buffer.context else { return false }

    var saved: [(CALayer, Bool)] = []
    for v in excluding {
      saved.append((v.layer, v.layer.isHidden))
      v.layer.isHidden = true
    }
    defer {
      // Restore within the same runloop turn — never committed (plan §16.5/§16.6).
      for (layer, wasHidden) in saved { layer.isHidden = wasHidden }
    }

    // Points-per-snapshot-pixel and the buffer origin in target-local points.
    let d = Double(req.downsample)
    let scale = Double(req.displayScale)
    let pxPerPoint = scale / d // snapshot px per point
    let originPtX = req.snapshotRect.x * d / scale
    let originPtY = req.snapshotRect.y * d / scale
    let capturePtRect = CGRect(
      x: originPtX, y: originPtY,
      width: Double(w) / pxPerPoint, height: Double(h) / pxPerPoint
    )

    ctx.saveGState()
    ctx.clear(CGRect(x: 0, y: 0, width: CGFloat(w), height: CGFloat(h)))
    // Flip to UIKit coordinates, then map the capture rect onto the buffer.
    ctx.translateBy(x: 0, y: CGFloat(h))
    ctx.scaleBy(x: 1, y: -1)
    ctx.scaleBy(x: CGFloat(pxPerPoint), y: CGFloat(pxPerPoint))
    ctx.translateBy(x: CGFloat(-originPtX), y: CGFloat(-originPtY))
    // Mandatory clip (M0 finding 2): lets CoreGraphics cull content outside the region.
    ctx.clip(to: capturePtRect)
    req.target.layer.render(in: ctx)
    ctx.restoreGState()
    return true
  }
}
