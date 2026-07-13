import XCTest
@testable import PipelineMathKit

/// Runs the Swift mirrors against the language-neutral fixture table
/// (test/pipeline-fixtures.json), the same file consumed by the TS jest suite and the Kotlin
/// JVM suite (PIPELINE_SPEC §11). Suites not implemented natively on iOS are intentionally
/// skipped: radiusForSigma is the Android HWUI inversion (iOS passes sigma straight to MPS,
/// spec §2) and parseColor happens in RN's JS color parser before props reach native.
final class PipelineFixturesTests: XCTestCase {

  static let eps = 1e-6

  static var fixtures: [String: [[String: Any]]] = {
    // #filePath: .../swift-tests/Tests/PipelineMathKitTests/PipelineFixturesTests.swift
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<3 { url.deleteLastPathComponent() }
    url.appendPathComponent("test/pipeline-fixtures.json")
    // one level short (swift-tests/ -> repo root)
    if !FileManager.default.fileExists(atPath: url.path) {
      var alt = URL(fileURLWithPath: #filePath)
      for _ in 0..<4 { alt.deleteLastPathComponent() }
      alt.appendPathComponent("test/pipeline-fixtures.json")
      url = alt
    }
    guard let data = try? Data(contentsOf: url),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      fatalError("cannot load pipeline-fixtures.json at \(url.path)")
    }
    var out: [String: [[String: Any]]] = [:]
    for (k, v) in json where k != "_meta" {
      out[k] = v as? [[String: Any]] ?? []
    }
    return out
  }()

  private func d(_ row: [String: Any], _ key: String) -> Double {
    (row[key] as? NSNumber)?.doubleValue ?? .nan
  }

  private func rect(_ any: Any?) -> PipelineMath.Rect {
    let m = any as? [String: Any] ?? [:]
    return PipelineMath.Rect(
      x: d(m, "x"), y: d(m, "y"), width: d(m, "width"), height: d(m, "height")
    )
  }

  private func rgba(_ any: Any?) -> PipelineMath.RGBA {
    let m = any as? [String: Any] ?? [:]
    return PipelineMath.RGBA(r: d(m, "r"), g: d(m, "g"), b: d(m, "b"), a: d(m, "a"))
  }

  private func assertRect(_ actual: PipelineMath.Rect, _ expected: PipelineMath.Rect, _ ctx: String) {
    XCTAssertEqual(actual.x, expected.x, accuracy: Self.eps, "\(ctx) x")
    XCTAssertEqual(actual.y, expected.y, accuracy: Self.eps, "\(ctx) y")
    XCTAssertEqual(actual.width, expected.width, accuracy: Self.eps, "\(ctx) width")
    XCTAssertEqual(actual.height, expected.height, accuracy: Self.eps, "\(ctx) height")
  }

  func testSigmaPxFromDp() {
    for (i, row) in Self.fixtures["sigmaPxFromDp"]!.enumerated() {
      XCTAssertEqual(
        PipelineMath.sigmaPxFromDp(d(row, "blurRadiusDp"), displayScale: d(row, "displayScale")),
        d(row, "expected"), accuracy: Self.eps, "row \(i)"
      )
    }
  }

  func testSigmaSnapshotFromPx() {
    for (i, row) in Self.fixtures["sigmaSnapshotFromPx"]!.enumerated() {
      XCTAssertEqual(
        PipelineMath.sigmaSnapshotFromPx(d(row, "sigmaPx"), downsample: Int(d(row, "downsample"))),
        d(row, "expected"), accuracy: Self.eps, "row \(i)"
      )
    }
  }

  func testAutoDownsample() {
    for (i, row) in Self.fixtures["autoDownsample"]!.enumerated() {
      XCTAssertEqual(
        PipelineMath.autoDownsample(
          sigmaPx: d(row, "sigmaPx"),
          captureAreaPx: d(row, "captureAreaPx"),
          quality: row["quality"] as? String ?? "balanced"
        ),
        Int(d(row, "expected")), "row \(i)"
      )
    }
  }

  func testSupportMarginPx() {
    for (i, row) in Self.fixtures["supportMarginPx"]!.enumerated() {
      XCTAssertEqual(
        PipelineMath.supportMarginPx(d(row, "sigmaPx")),
        d(row, "expected"), accuracy: Self.eps, "row \(i)"
      )
    }
  }

  func testExpandCaptureRect() {
    for (i, row) in Self.fixtures["expandCaptureRect"]!.enumerated() {
      assertRect(
        PipelineMath.expandCaptureRect(
          visible: rect(row["visibleRect"]),
          targetBounds: rect(row["targetBounds"]),
          sigmaPx: d(row, "sigmaPx")
        ),
        rect(row["expected"]), "row \(i)"
      )
    }
  }

  func testSnapshotRectFor() {
    for (i, row) in Self.fixtures["snapshotRectFor"]!.enumerated() {
      assertRect(
        PipelineMath.snapshotRectFor(rect(row["captureRectPx"]), downsample: Int(d(row, "downsample"))),
        rect(row["expected"]), "row \(i)"
      )
    }
  }

  func testCropRectFor() {
    for (i, row) in Self.fixtures["cropRectFor"]!.enumerated() {
      let snapshot = PipelineMath.snapshotRectFor(
        rect(row["captureRectPx"]), downsample: Int(d(row, "downsample"))
      )
      assertRect(
        PipelineMath.cropRectFor(
          visible: rect(row["visibleRect"]), snapshotRect: snapshot,
          downsample: Int(d(row, "downsample"))
        ),
        rect(row["expected"]), "row \(i)"
      )
    }
  }

  func testSaturationMatrix() {
    for (i, row) in Self.fixtures["saturationMatrix"]!.enumerated() {
      let m = PipelineMath.saturationMatrix(d(row, "s"))
      let expected = (row["expected"] as? [NSNumber])?.map { $0.doubleValue } ?? []
      XCTAssertEqual(m.count, expected.count, "row \(i) count")
      for j in 0..<min(m.count, expected.count) {
        XCTAssertEqual(m[j], expected[j], accuracy: Self.eps, "row \(i) entry \(j)")
      }
    }
  }

  func testSourceOver() {
    for (i, row) in Self.fixtures["sourceOver"]!.enumerated() {
      let out = PipelineMath.sourceOver(src: rgba(row["src"]), dst: rgba(row["dst"]))
      let expected = rgba(row["expected"])
      XCTAssertEqual(out.r, expected.r, accuracy: Self.eps, "row \(i) r")
      XCTAssertEqual(out.g, expected.g, accuracy: Self.eps, "row \(i) g")
      XCTAssertEqual(out.b, expected.b, accuracy: Self.eps, "row \(i) b")
      XCTAssertEqual(out.a, expected.a, accuracy: Self.eps, "row \(i) a")
    }
  }
}
