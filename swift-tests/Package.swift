// swift-tools-version:5.9
// Fixture-parity suite for the Swift pipeline math (docs/PIPELINE_SPEC.md §11).
// Sources/PipelineMathKit/PipelineMath.swift is a SYMLINK to ios/PipelineMath.swift —
// the exact file compiled into the pod — so `swift test` exercises the shipped math
// against test/pipeline-fixtures.json, mirroring the Kotlin JVM suite.
import PackageDescription

let package = Package(
  name: "ParityBlurMathTests",
  targets: [
    .target(name: "PipelineMathKit", path: "Sources/PipelineMathKit"),
    .testTarget(
      name: "PipelineMathKitTests",
      dependencies: ["PipelineMathKit"],
      path: "Tests/PipelineMathKitTests"
    ),
  ]
)
