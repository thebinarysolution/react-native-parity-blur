import Foundation

/// Swift mirror of the canonical pipeline reference (docs/PIPELINE_SPEC.md; src/pipeline/*.ts).
/// Pure math, no UIKit/Metal imports — the SPM fixture suite (swift-tests/) compiles this same
/// file against test/pipeline-fixtures.json, exactly like the Kotlin PipelineMath JVM tests.
/// When the spec changes, change TS + Kotlin + this file in the same commit.
public enum PipelineMath {

  // MARK: - Constants (PIPELINE_SPEC §2, §3, §4, §7 — single home on the iOS side)

  /// Gaussian support multiplier for capture expansion (spec §3.1).
  public static let captureSupportK = 3.0
  /// Auto-downsample: keep sigmaSnapshot >= this many snapshot px (spec §4).
  public static let minSigmaSnapshot = 1.0
  /// Auto-downsample: captures below this area (device px^2) never exceed 2x (spec §4).
  public static let smallCaptureAreaPx = 256.0 * 256.0
  /// Rec. 709 luma coefficients (spec §7).
  public static let lumaR = 0.2126
  public static let lumaG = 0.7152
  public static let lumaB = 0.0722

  public struct Rect: Equatable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
      self.x = x; self.y = y; self.width = width; self.height = height
    }
  }

  public struct RGBA: Equatable {
    public var r: Double
    public var g: Double
    public var b: Double
    public var a: Double
    public init(r: Double, g: Double, b: Double, a: Double) {
      self.r = r; self.g = g; self.b = b; self.a = a
    }
  }

  // MARK: - Units (spec §1)

  public static func sigmaPxFromDp(_ blurRadiusDp: Double, displayScale: Double) -> Double {
    guard blurRadiusDp.isFinite, blurRadiusDp > 0 else { return 0 }
    guard displayScale.isFinite, displayScale > 0 else { return 0 }
    return blurRadiusDp * displayScale
  }

  public static func sigmaSnapshotFromPx(_ sigmaPx: Double, downsample: Int) -> Double {
    guard sigmaPx.isFinite, sigmaPx > 0 else { return 0 }
    return sigmaPx / Double(downsample)
  }

  /// iOS blur parameter (spec §2): MPSImageGaussianBlur takes the snapshot sigma directly.
  public static func iosSigmaForSigma(_ sigmaSnapshot: Double) -> Double {
    guard sigmaSnapshot.isFinite, sigmaSnapshot > 0 else { return 0 }
    return sigmaSnapshot
  }

  // MARK: - Downsample selection (spec §4)

  public static func autoDownsample(sigmaPx: Double, captureAreaPx: Double, quality: String) -> Int {
    guard sigmaPx.isFinite, sigmaPx > 0 else { return 1 }
    let maxByQuality: Int
    switch quality {
    case "high": maxByQuality = 2
    case "performance": maxByQuality = 8
    default: maxByQuality = 4 // balanced
    }
    let maxBySigma = Int((sigmaPx / minSigmaSnapshot).rounded(.down))
    let area = captureAreaPx.isFinite ? captureAreaPx : 0
    let maxByArea = area < smallCaptureAreaPx ? 2 : 8
    let cap = min(maxByQuality, min(maxBySigma, maxByArea))
    for factor in [8, 4, 2, 1] where factor <= cap {
      return factor
    }
    return 1
  }

  public static func resolveDownsample(
    prop: Int, sigmaPx: Double, captureAreaPx: Double, quality: String
  ) -> Int {
    // 0 = the 'auto' sentinel (see ParityBlurViewNativeComponent.ts).
    if prop == 1 || prop == 2 || prop == 4 || prop == 8 { return prop }
    return autoDownsample(sigmaPx: sigmaPx, captureAreaPx: captureAreaPx, quality: quality)
  }

  // MARK: - Capture-rect math (spec §3); all rects in target-local DEVICE PX

  public static func supportMarginPx(_ sigmaPx: Double, k: Double = captureSupportK) -> Double {
    guard sigmaPx.isFinite, sigmaPx > 0 else { return 0 }
    return (k * sigmaPx).rounded(.up)
  }

  public static func intersect(_ a: Rect, _ b: Rect) -> Rect {
    let x0 = max(a.x, b.x)
    let y0 = max(a.y, b.y)
    let x1 = min(a.x + a.width, b.x + b.width)
    let y1 = min(a.y + a.height, b.y + b.height)
    let w = max(0, x1 - x0)
    let h = max(0, y1 - y0)
    if w == 0 || h == 0 { return Rect(x: x0, y: y0, width: 0, height: 0) }
    return Rect(x: x0, y: y0, width: w, height: h)
  }

  public static func expandCaptureRect(
    visible: Rect, targetBounds: Rect, sigmaPx: Double, k: Double = captureSupportK
  ) -> Rect {
    let m = supportMarginPx(sigmaPx, k: k)
    let expanded = Rect(
      x: visible.x - m, y: visible.y - m,
      width: visible.width + 2 * m, height: visible.height + 2 * m
    )
    return intersect(expanded, targetBounds)
  }

  public static func rectArea(_ r: Rect) -> Double { r.width * r.height }

  /// Snapshot rect in INTEGER snapshot px: origin FLOORS, far edge CEILS (locked rule, spec §3.3).
  public static func snapshotRectFor(_ captureRectPx: Rect, downsample: Int) -> Rect {
    let d = Double(downsample)
    let x = (captureRectPx.x / d).rounded(.down)
    let y = (captureRectPx.y / d).rounded(.down)
    let farX = ((captureRectPx.x + captureRectPx.width) / d).rounded(.up)
    let farY = ((captureRectPx.y + captureRectPx.height) / d).rounded(.up)
    return Rect(x: x, y: y, width: max(0, farX - x), height: max(0, farY - y))
  }

  /// Fractional crop rect in SNAPSHOT PX selecting the visible region (spec §3.4).
  ///
  /// Intersected with the snapshot's own extent: `expandCaptureRect` CLAMPS the capture to the
  /// target bounds, but this crop is derived from the UNCLAMPED visible rect, so a view lying
  /// partly outside the target (e.g. a fullscreen backdrop inside a sheet host mid-transform)
  /// would otherwise select pixels the snapshot never captured, presenting the captured band at a
  /// DISPLACED offset. Whenever the visible rect is contained in the target bounds -- every case
  /// the fixtures and the calibration harness exercise -- the snapshot already covers visible/D
  /// and this intersection is the IDENTITY.
  public static func cropRectFor(visible: Rect, snapshotRect: Rect, downsample: Int) -> Rect {
    let d = Double(downsample)
    let raw = Rect(
      x: visible.x / d - snapshotRect.x,
      y: visible.y / d - snapshotRect.y,
      width: visible.width / d,
      height: visible.height / d
    )
    return intersect(raw, Rect(x: 0, y: 0, width: snapshotRect.width, height: snapshotRect.height))
  }

  // MARK: - Saturation matrix (spec §7): row-major 4x5, Android ColorMatrix layout

  public static func saturationMatrix(
    _ s: Double, lr: Double = lumaR, lg: Double = lumaG, lb: Double = lumaB
  ) -> [Double] {
    let t = 1 - s
    return [
      t * lr + s, t * lg, t * lb, 0, 0,
      t * lr, t * lg + s, t * lb, 0, 0,
      t * lr, t * lg, t * lb + s, 0, 0,
      0, 0, 0, 1, 0,
    ]
  }

  public static func applySaturation(
    matrix m: [Double], r: Double, g: Double, b: Double, a: Double
  ) -> RGBA {
    func c01(_ v: Double) -> Double { v < 0 ? 0 : (v > 1 ? 1 : v) }
    return RGBA(
      r: c01(m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4]),
      g: c01(m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9]),
      b: c01(m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14]),
      a: m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19]
    )
  }

  // MARK: - Overlay source-over (spec §8), straight alpha

  public static func sourceOver(src: RGBA, dst: RGBA) -> RGBA {
    let outA = src.a + dst.a * (1 - src.a)
    guard outA > 0 else { return RGBA(r: 0, g: 0, b: 0, a: 0) }
    func blend(_ sc: Double, _ dc: Double) -> Double {
      (sc * src.a + dc * dst.a * (1 - src.a)) / outA
    }
    return RGBA(r: blend(src.r, dst.r), g: blend(src.g, dst.g), b: blend(src.b, dst.b), a: outA)
  }
}
