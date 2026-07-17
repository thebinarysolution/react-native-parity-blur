import Foundation

/// Field diagnostics for ParityBlur (plan §42.4, §40).
///
/// Enabled at RUNTIME, with no rebuild and no code change, by either:
///
///   * a launch argument — Xcode ▸ Edit Scheme ▸ Run ▸ Arguments ▸ `-ParityBlurDebug YES`
///     (UserDefaults reads launch arguments, so this needs no code and no plist), or
///   * an environment variable — `PARITY_BLUR_DEBUG=1` in the same Arguments tab.
///
/// Then read the output in Xcode's console, or `log stream --predicate 'eventMessage CONTAINS
/// "ParityBlur"'` on a Mac with the device attached.
///
/// This exists because a `BlurView` showing no blur looks IDENTICAL whether it never captured,
/// captured something empty, or captured fine but resolved `blurRadius` to 0 and is faithfully
/// presenting an unblurred snapshot. Only a log separates those, and asking a user to patch a
/// constant and rebuild is not a diagnostic path anyone completes.
enum ParityBlurDebug {

  /// Resolved once per process — the backing values cannot change after launch.
  static let enabled: Bool = {
    if UserDefaults.standard.bool(forKey: "ParityBlurDebug") { return true }
    let env = ProcessInfo.processInfo.environment["PARITY_BLUR_DEBUG"]
    return env == "1" || env?.lowercased() == "true" || env?.lowercased() == "yes"
  }()

  @inline(__always)
  static func log(_ event: @autoclosure () -> String) {
    if enabled { NSLog("[ParityBlur] %@", event()) }
  }

  /// Always emitted, never gated: these are states that are almost certainly a mistake and are
  /// otherwise INVISIBLE (they look like "the library does nothing"). The whole point is that the
  /// user has not enabled anything and does not know they should. Call sites must be one-shot per
  /// view — never per frame.
  static func warnOnce(_ message: String) {
    NSLog("[ParityBlur] WARNING: %@", message)
  }
}
