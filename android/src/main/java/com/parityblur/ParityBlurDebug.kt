package com.parityblur

import android.util.Log

/**
 * Field diagnostics for ParityBlur (plan §42.4, §40).
 *
 * Toggled at RUNTIME, with no rebuild and no code change, on any build including release:
 *
 * ```
 * adb shell setprop log.tag.ParityBlur DEBUG
 * adb logcat -s ParityBlur:D
 * # ...reproduce, then:
 * adb shell setprop log.tag.ParityBlur INFO   # off again
 * ```
 *
 * This exists because a `BlurView` that shows no blur looks IDENTICAL on screen whether it never
 * captured, captured something empty, or captured fine but resolved `blurRadius` to 0 and is
 * faithfully presenting an unblurred snapshot. Only a log can tell those apart, and asking a user
 * to patch a constant and rebuild is not a diagnostic path anyone completes.
 *
 * Cost when off: [Log.isLoggable] is a cached system-property read, and every call site passes a
 * lambda that is only invoked when enabled, so no string is ever built in a normal build.
 */
internal object ParityBlurDebug {

  /** Must be <= 23 chars (Log.isLoggable throws otherwise). */
  const val TAG = "ParityBlur"

  /** True while `setprop log.tag.ParityBlur DEBUG` (or VERBOSE) is set. */
  val enabled: Boolean
    get() = Log.isLoggable(TAG, Log.DEBUG)

  inline fun log(event: () -> String) {
    if (enabled) Log.d(TAG, event())
  }

  /**
   * Always-emitted warning for states that are almost certainly a mistake and that are otherwise
   * INVISIBLE (they look like "the library does nothing"). Deliberately not gated behind [enabled]:
   * the whole point is that the user has not enabled anything and does not know they should.
   * Every call site must be one-shot per view — never per frame.
   */
  fun warnOnce(message: String) {
    Log.w(TAG, message)
  }
}
