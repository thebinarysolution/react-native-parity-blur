# Known Limitations

This is the up-front limitations list required by `docs/MASTER_PLAN.md` §43. It documents
intentional v1 scope boundaries (§44 non-goals) and known technical constraints — not bugs to be
silently worked around. If you hit one of these, the fix is almost always "use `blurTarget`-free
default capture, avoid the unsupported surface type, or call `refresh()`," not a library change.

## Cross-window / Modal capture

A `BlurView` cannot capture content that lives in a different native window than the one it's
mounted in — this includes some React Native `Modal` configurations (which render into a separate
native window/`UIWindow` on iOS), other platform overlay windows, and system UI layers. If your
blur backdrop is expected to include content from another window, it will not appear in the
capture. Use `fallbackColor` for these cases, or restructure so the blurred content and its
backdrop share a window.

## Surface-backed content is not captured

View-hierarchy capture (both the software-canvas path used for static recapture and, on Android,
the first-capture `PixelCopy` path) may not correctly include content backed by an independent
compositor surface: `SurfaceView`, many video players, camera previews, map views, and other
external-texture surfaces. These render outside the normal view-drawing path the blur pipeline
walks. If your backdrop includes one of these, expect a gap (transparent/black) or stale content
in that region of the blur.

## Static mode needs an explicit `refresh()`

`mode="static"` (the default) captures the backdrop once — on mount and on layout or
capture-relevant prop changes — and then presents a frozen, still-blurred snapshot with no ongoing
per-frame cost. If the backdrop changes underneath it afterward (e.g. content behind it
re-rendered without a layout change), the blur will show the **old** backdrop until you either
call `ref.current?.refresh()` (coalesced, cheap to call repeatedly) or switch to `mode="live"`.

## Android: first capture vs. recapture differ in what they can see

Android's first capture after mount uses `PixelCopy` against the compositor-rendered window
content, which correctly includes GPU-composited (`Bitmap.Config.HARDWARE`) content — notably,
`Image` components that Fresco has decoded to a hardware bitmap on modern devices. Every
**recapture** after that (static `refresh()`, or a static prop change that triggers a new capture)
instead uses a software-`Canvas` draw pass for correctness/lifecycle reasons (plan §14.1/§14.2),
and a software canvas **cannot rasterize `HARDWARE` bitmaps** — Android silently skips drawing
them. Practically: an `Image`-heavy backdrop can look correct on first mount and then lose those
images from the blur on a subsequent `refresh()`. This is a known v1 gap (see
`android/src/main/java/com/parityblur/SoftwareSnapshotProvider.kt` and
`PixelCopySnapshotProvider.kt`), not something you can work around from JS today.

## iOS live mode is the most expensive path

Of every mode/platform combination, iOS `mode="live"` is expected to be the costliest, because
live capture has to re-snapshot, re-blur, and re-present every scheduled frame rather than doing
that work once. The library ships several mitigations by default — region/union capture planning
(only the visible+support area is captured, not the whole screen), downsampling, a shared
per-window snapshot/scheduler rather than one per view, a 30 FPS default cap (`maxFps`),
visibility-based pausing, backpressure, and stale-frame dropping — but live is still strictly more
expensive than static on both platforms, and more so on iOS. Prefer `mode="static"` with
`refresh()` wherever the backdrop only changes on discrete events; reserve `mode="live"` for
backdrops that are genuinely animating continuously (e.g. a header blurred over active scroll).
See `docs/PERFORMANCE.md` for measured numbers.

## Nested blur is deterministic, not an Apple-material emulation

Multiple/overlapping/nested `BlurView`s each run the same canonical pipeline independently and
deterministically — the result is well-defined and reproducible, but it does not attempt to
emulate how Apple's native material stacking (e.g. nested `UIVisualEffectView` vibrancy/blur
compounding) looks. Do not expect nested `BlurView`s to visually match nested native iOS
materials.

## No exact pixel identity

The library targets and measures **calibrated perceptual parity**, not pixel-identical output —
see `docs/CALIBRATION_REPORT.md` for the actual numbers (worst measured ΔE76 0.90, SSIM ≥ 0.983
across 110 strip comparisons). Exact pixel identity is not guaranteed, and is not the goal, across
OS versions, GPU vendors, device pixel scales, source content's own rasterization, or wide-gamut
color pipelines.

## Android below API 31: no real blur

`RenderEffect`, the only real-blur API this library uses on Android, requires API 31+. Below that,
there is intentionally no CPU blur fallback (plan §44 non-goal — a software Gaussian blur over
arbitrary view hierarchies is a materially different, much more expensive engineering problem this
library does not take on). Instead, the view renders `fallbackColor` as a flat color. Choose a
`fallbackColor` that approximates your backdrop's average color so older-Android users still get a
reasonable look.

## `blurTarget` is not implemented yet (v1.1)

The `blurTarget` prop (capture an explicit target view's subtree instead of the default backdrop,
plan §18) is part of the public API surface for future stability but has **no native-side effect
in v1** — passing it is silently accepted and ignored. It's deferred to a v1.1 release; do not
rely on it today.

## Also deferred to v1.1 (plan §44 non-goals for v1)

Explicitly out of scope for this release, tracked for later: Android's *structural* live fast path
(RenderNode live-reference blur, as opposed to the current live-capture path — plan §14.1/§39),
`blurTarget` (above), private iOS blur APIs (never planned — deliberately excluded on principle,
not just deferred), automatic system-material parity, cross-window capture, `SurfaceView` capture
workarounds, and legacy (non-Fabric/"Paper") architecture support.
