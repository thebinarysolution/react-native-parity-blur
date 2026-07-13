# Performance

Measured numbers from `docs/HARDENING_REPORT.md` (Milestone 7), plus tuning guidance for the
`quality`/`downsample`/`maxFps` props. Reproduce any number below by flipping the `enabled` flag
on the debug instrumentation (`ParityBlurDebug`, both platforms — **false** by default, zero
shipped cost) and following `docs/HARDENING_REPORT.md`'s method.

## Measured numbers (Android, Pixel 6a API 36, `dumpsys gfxinfo`)

**Live blur over an auto-scrolling backdrop — the worst case exercised** (`LiveHeaderScreen`,
10 seconds continuous):

| Metric | Value |
|---|---|
| Janky frames | **0 (0.00%)** |
| Missed Vsync | 0 |
| Frame time p50 / p90 / p95 / p99 | 8 / 11 / 12 / 13 ms |
| GPU time p50 / p95 | 1 / 2 ms |

All of those sit comfortably under the 16.67 ms (60 Hz) frame budget — the `RenderEffect` blur
itself costs roughly 1–2 ms of GPU time per frame; the rest is ordinary compositing.

**Static mode after the initial capture:** **0 rendered frames over 6 seconds** of an idle
all-static screen. This is the direct proof of plan §20/§27 laziness — once the snapshot is
presented, a static `BlurView` does no further per-frame work at all until you call `refresh()` or
change a capture-relevant prop.

iOS device numbers were not captured at runtime due to a device-tooling gap (this app's `NSLog`
output doesn't currently surface through the available syslog tools on the test iPhone) — the iOS
lifecycle code is structurally identical to the verified Android coordinator (same install/pause/
uninstall pattern) and was verified correct by inspection plus on-device visual confirmation; see
`docs/HARDENING_REPORT.md` §"iOS runtime verification note" for the full explanation. Treat iOS
live as the more expensive of the two live paths (see `docs/LIMITATIONS.md`) until a Instruments
run fills this gap.

## When to use `mode="static"` vs `mode="live"`

- **Default to `mode="static"`.** It's dramatically cheaper: one capture, then zero ongoing cost.
  Correct for bottom sheets, modals, cards, and any backdrop that only changes on discrete events
  — pair it with `ref.current?.refresh()` called after those events (navigation, data load, sheet
  open, etc.). Repeated `refresh()` calls before the pending capture runs coalesce into one, so
  it's safe to call eagerly.
- **Use `mode="live"` only when the backdrop is genuinely animating continuously** underneath the
  blur — e.g. a header blurred over an actively scrolling list, or blur over a running animation.
  Live mode costs strictly more than static on both platforms (continuous recapture + reblur +
  represent every scheduled frame) and iOS live is the single most expensive mode/platform
  combination in this library (see `docs/LIMITATIONS.md`). The measured numbers above show it's
  well within budget on Android at default settings — but it is not free, and multiple simultaneous
  live views multiply that cost.
- A live `BlurView` automatically pauses its recapture scheduling when it isn't visible/mounted, so
  off-screen live views (e.g. scrolled out of view, or on an inactive tab) don't cost anything
  while hidden — no manual toggling needed for that case.

## `quality` and `downsample` tuning

`downsample="auto"` (the default) is almost always the right choice — it picks the largest safe
downsample factor for the current `blurRadius`, capture area, and `quality` tier
(`docs/PIPELINE_SPEC.md` §4), balancing blur-kernel cost against visual quality automatically. The
factor scales the *capture and blur* work quadratically (a 2× downsample is ~4× less blur/capture
work), so it's the single biggest performance lever available:

| `quality` | Downsample ceiling | Use when |
|---|---|---|
| `'high'` | prefers 1×/2× | Small, high-detail blur regions where softness/banding at high downsample would be visible (e.g. a small, heavily-zoomed blur area). |
| `'balanced'` (default) | prefers 2×/4× | The right default for almost everything — bottom sheets, headers, cards. |
| `'performance'` | prefers 4×/8× | Large blur regions, `mode="live"`, lower-end devices, or several simultaneous `BlurView`s where every frame's cost is multiplied. |

Auto-selection also never downsamples below what keeps at least ~1 snapshot-domain pixel of sigma
(so the blur kernel doesn't degenerate) and never exceeds 2× for small capture regions (< 256×256
device px) since aggressive reduction there buys negligible speedup. You can bypass all of this and
force an exact factor (`downsample={1|2|4|8}`) for advanced tuning, but prefer `quality` first —
it's the intended, portable knob.

## `maxFps` guidance

`maxFps` (default 30, clamped to `[1, 120]`) only affects `mode="live"`. 30 FPS is a deliberate
default, not just "half of 60": it roughly halves live capture/blur/present work relative to
uncapped 60 FPS while remaining visually smooth for a *backdrop* effect (as opposed to foreground
motion, where dropped frames are more noticeable). Guidance:

- Leave it at the default for typical live headers/scroll effects.
- Lower it (e.g. `15`) for `quality="performance"` scenarios, several simultaneous live views, or
  lower-end Android devices, if you observe jank in your own profiling.
- Raising it above 30 mainly matters for blur tracking fast, high-motion content very closely;
  weigh that against the extra continuous GPU/main-thread cost, especially on iOS where live is
  already the costliest path.

## General guidance

- Prefer fewer, larger `BlurView`s over many small ones where layout allows — each live view adds
  to the shared per-window scheduler's per-frame workload.
- A `blurRadius` of `0` (or omitted) is intentionally treated as a full no-op, all the way down to
  skipping the native blur backend call (plan §12/§27) — conditionally rendering a `BlurView` only
  once you actually want blur is cheap, not a wasted mount.
- Nothing in this library initializes eagerly: importing the package, or shipping a build that
  never mounts a `BlurView`, does no blur-engine or scheduler setup at all (plan §27, verified in
  `docs/HARDENING_REPORT.md`'s laziness matrix). Cost only appears once (and for as long as) a
  `BlurView` that's actually eligible to blur is mounted and visible.
