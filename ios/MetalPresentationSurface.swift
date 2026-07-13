import UIKit

/// CAMetalLayer-backed presentation surface (plan §15.5): the blurred result is composited by
/// Core Animation directly from the drawable — zero GPU→CPU readback in the present path
/// (M0-verified). The layer bilinearly scales drawable pixels up to the view's bounds, which is
/// the spec §9.12 upsample step.
final class MetalPresentationView: UIView {
  override class var layerClass: AnyClass { CAMetalLayer.self }
  var metalLayer: CAMetalLayer { layer as! CAMetalLayer }

  private let maskLayer = CAShapeLayer()
  private var cornerRadii: [CGFloat] = [0, 0, 0, 0] // TL, TR, BR, BL

  /// Rounded clipping of the blur OUTPUT only (plan §31): children are siblings of this view
  /// and keep normal RN overflow semantics.
  func setCornerRadii(topLeft: CGFloat, topRight: CGFloat, bottomRight: CGFloat, bottomLeft: CGFloat) {
    let next = [topLeft, topRight, bottomRight, bottomLeft]
    guard next != cornerRadii else { return }
    cornerRadii = next
    updateMask()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    updateMask()
  }

  private func updateMask() {
    let (tl, tr, br, bl) = (cornerRadii[0], cornerRadii[1], cornerRadii[2], cornerRadii[3])
    if tl <= 0 && tr <= 0 && br <= 0 && bl <= 0 {
      layer.mask = nil
      return
    }
    let path = CGMutablePath()
    let r = bounds
    guard r.width > 0, r.height > 0 else { return }
    path.move(to: CGPoint(x: r.minX + tl, y: r.minY))
    path.addLine(to: CGPoint(x: r.maxX - tr, y: r.minY))
    path.addArc(tangent1End: CGPoint(x: r.maxX, y: r.minY), tangent2End: CGPoint(x: r.maxX, y: r.minY + tr), radius: max(tr, 0.001))
    path.addLine(to: CGPoint(x: r.maxX, y: r.maxY - br))
    path.addArc(tangent1End: CGPoint(x: r.maxX, y: r.maxY), tangent2End: CGPoint(x: r.maxX - br, y: r.maxY), radius: max(br, 0.001))
    path.addLine(to: CGPoint(x: r.minX + bl, y: r.maxY))
    path.addArc(tangent1End: CGPoint(x: r.minX, y: r.maxY), tangent2End: CGPoint(x: r.minX, y: r.maxY - bl), radius: max(bl, 0.001))
    path.addLine(to: CGPoint(x: r.minX, y: r.minY + tl))
    path.addArc(tangent1End: CGPoint(x: r.minX, y: r.minY), tangent2End: CGPoint(x: r.minX + tl, y: r.minY), radius: max(tl, 0.001))
    path.closeSubpath()
    maskLayer.frame = bounds
    maskLayer.path = path
    layer.mask = maskLayer
  }
}
