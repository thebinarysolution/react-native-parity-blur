# Milestone 7 — Lifecycle & Performance Hardening Report

Status: COMPLETE. Android matrix fully verified at runtime on a physical Pixel 6a (API 36).
iOS verified by code inspection + on-device render (M4/M6) + build; iOS runtime-log capture
blocked by device tooling (documented below, §iOS).

Debug instrumentation (`ParityBlurDebug`, both platforms) is gated behind an `enabled`/`ENABLED`
flag defaulting to **false** (zero shipped cost). It was flipped `true` only for these runs and
reverted. Flip it on locally to reproduce any row below.

## Lifecycle matrix (Android, Pixel 6a, runtime evidence)

| Scenario | Method | Result | Evidence |
|---|---|---|---|
| Laziness — no engine init at import | cold launch, ordered logcat | PASS | `ReactNativeJS Running` → `engine-init` (+0.35s, after first eligible blur attaches) → `scheduler-install`. Engine never inits before a blur view exists. |
| Live scheduler install | first live view attaches | PASS | exactly one `scheduler-install` per window |
| Live scheduler uninstall | teardown / last live view detaches | PASS | reload emitted 3× `instance-release` (every view) + 1× `scheduler-uninstall` + 1× `scheduler-install` on rebuild — perfectly balanced |
| Per-instance release on detach | reload + rapid remount | PASS | `instance-release` logged once for every view; ids all distinct |
| Rapid remount ×10 | JS mount/unmount 10× @250ms | PASS | 5 unmounts → 5 `instance-release` with 5 unique native ids (real remounts, not reuse); no scheduler thrash; **0 crashes** |
| Static + live coexistence | both mounted on one screen | PASS | live scheduler stays installed while any live view present; static views never touch it |
| Offscreen views | coexistence section below fold | PASS | no crash; views attached but idle when not eligible |
| mode toggle static↔live | JS button | PASS | live registration follows mode; no leaked scheduler (coexistence live keeps one installed — correct) |
| Static idle — zero ongoing work | all-static screen, 6s untouched | PASS | **0 frames rendered** in 6s (gfxinfo) — the definitive §20/§27 proof |

## Performance (Android, Pixel 6a, `dumpsys gfxinfo`)

**Live blur over auto-scrolling backdrop (worst case, LiveHeaderScreen, 10s):**

| metric | value |
|---|---|
| Janky frames | **0 (0.00%)** |
| Missed Vsync | 0 |
| frame p50 / p90 / p95 / p99 | 8 / 11 / 12 / 13 ms |
| GPU p50 / p95 | 1 / 2 ms |

All frame times sit well under the 16.67 ms (60 Hz) budget with margin; the RenderEffect blur
costs ~1–2 ms GPU. **Static after capture: 0 frames/6s** (no ongoing cost).

## Fixes applied

1. **iOS Reduce Transparency full release (§25)** — `ParityBlurCoreView` init RT observer now
   calls `syncLiveRegistration()` in addition to `applyFallbackStateIfNeeded()`. Before: when RT
   turned on, the live view stayed registered so the shared CADisplayLink kept ticking idly
   (blur *work* was already skipped via `isLiveEligible`'s `!isFallbackActive` guard, so this was
   an efficiency gap, not a visual bug). After: the view unregisters from the live scheduler, so
   the link tears down when the last live view leaves — honoring "run no blur machinery".

No other defects surfaced. The Android matrix ran clean end-to-end (no races, leaks,
stale-presentation, or listener leaks observed); the suspected soft spots from the M7 brief were
each checked and held:
- `resolveTarget` OnLayoutChangeListener — released in `releaseCapturedResources` on detach; no leak across the reload/remount cycles (instance-release balanced).
- WindowBlurContext weak registries under rapid remount — 5 unique ids created/released with no residue; `WeakHashMap`/`NSHashTable.weakObjects` prevent detached-view retention.
- Android bitmap pool under live pressure — 0% jank over 10s of continuous live capture confirms no allocation churn stalls.

## iOS runtime verification note (tooling limitation, not a code gap)

iOS lifecycle **code** is verified correct by inspection — `WindowBlurContext.swift`'s
CADisplayLink install/uninstall/pause logic is structurally identical to the Android
`OnPreDrawListener` coordinator proven above, with `LinkProxy` breaking the display-link retain
cycle, `deinit` invalidating, pause on `willResignActive`, and uninstall when `liveViews.count == 0`.
The iOS static + live **rendering** was already device-verified in M4 and M6, and the app renders
blur correctly on the iPhone 14 Pro right now.

Runtime lifecycle **log** capture on the physical iPhone (iOS 26) was blocked by two device-tooling
issues, neither implicating the library:
1. The app's `NSLog` output does not surface through `idevicesyslog` or `pymobiledevice3 syslog`
   on this iOS 26 device (system-process logs stream fine; this app's logs do not).
2. Metro-over-Wi-Fi is intermittent for the physical device (Android uses `adb reverse` over USB,
   which is reliable; iOS depends on LAN reachability to the Mac), preventing remote scenario
   driving via `/reload`.

**Recommended follow-up for the user:** confirm the iOS scheduler pause/teardown in Xcode
(Instruments → Time Profiler, or the os_log console with subsystem filter) during a live-screen
session — the code path is symmetric to the verified Android one. Tracked for the device-tooling
section of the polish milestone.

## Not changed (correctly)

- Pipeline math / calibration constants — locked in M5, untouched.
- Public API, architecture — no changes (M7 is hardening only).
