package com.parityblur

import android.util.Log

/**
 * Milestone 7 laziness/lifecycle instrumentation (plan §42.4, §40).
 *
 * Gated behind [ENABLED], which defaults to `false` so a shipped build pays zero cost here (no
 * fields mutated, no string built, no log call made -- the `inline` + constant-folded branch is
 * dropped by the compiler). Flip to `true` only for local hardening runs to prove:
 *   - package import -> no engine init (nothing logs before the first eligible capture)
 *   - first eligible BlurView -> "engine-init" logs exactly once per process
 *   - live registration -> "scheduler-install"/"scheduler-uninstall" bracket the live window
 *   - detach -> "instance-release" logs for every ParityBlurView, live or static
 */
internal object ParityBlurDebug {
  const val ENABLED = false // debug-only laziness/lifecycle instrumentation (plan §42.4); flip true for local hardening runs

  private const val TAG = "ParityBlur.Debug"

  inline fun log(event: () -> String) {
    if (ENABLED) Log.d(TAG, event())
  }
}
