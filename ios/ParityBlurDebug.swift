import Foundation

/// Milestone 7 laziness/lifecycle instrumentation (plan §42.4, §40).
///
/// Gated behind `enabled`, which defaults to `false` so a shipped build pays zero cost here.
/// Flip to `true` only for local hardening runs to prove:
///   - package import -> no engine init (nothing logs before the first eligible capture)
///   - first eligible BlurView -> "engine-init" logs exactly once per process
///   - live registration -> "scheduler-install"/"scheduler-uninstall" bracket the live window
///   - detach -> "instance-release" logs for every ParityBlurCoreView, live or static
enum ParityBlurDebug {
  static let enabled = false // debug-only laziness/lifecycle instrumentation (plan §42.4); flip true for local hardening runs

  @inline(__always)
  static func log(_ event: @autoclosure () -> String) {
    if enabled { NSLog("[ParityBlur.Debug] %@", event()) }
  }
}
