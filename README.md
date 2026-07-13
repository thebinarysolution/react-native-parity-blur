# react-native-parity-blur

Cross-platform native backdrop blur for React Native (New Architecture / Fabric).

## Why

Every React Native blur library today wraps a different native primitive with a different
default look — `UIVisualEffectView` on iOS, a custom renderscript/RenderEffect approximation on
Android — and ships no cross-platform definition of what a given "blur amount" should look like.
The result: the same prop value produces a visibly different blur on each platform, and there is
no way to reason about it other than eyeballing a device.

`react-native-parity-blur` starts from one canonical, documented blur pipeline
(docs/PIPELINE_SPEC.md) — a single Gaussian-sigma unit, a single capture/downsample/blur/
saturate/overlay order, the same edge handling, the same color space — and implements it natively
on both platforms: real `RenderEffect` on Android (API 31+), real `MPSImageGaussianBlur` on iOS.
The two backends were then calibrated against each other on physical devices
(docs/CALIBRATION_REPORT.md): across 110 measured strip comparisons, the worst per-strip color
difference is **ΔE76 0.90** and the lowest structural similarity is **SSIM 0.983** — i.e. the same
`blurRadius` really does mean the same thing on both platforms, not just approximately.

## Installation

```sh
npm install react-native-parity-blur
```

or

```sh
yarn add react-native-parity-blur
```

This library ships native Kotlin and Swift code and requires **autolinking** (no manual native
setup) and a native rebuild after install (`pod install` for iOS, then a full app rebuild — a
JS-only reload is not enough).

### Requirements

- **React Native 0.76+ with the New Architecture (Fabric) enabled.** This is a Fabric-only
  package (`create-react-native-library` type `fabric-view`); it does not support the legacy
  (Paper) renderer.
- **iOS**: real blur on all supported iOS versions via Metal Performance Shaders.
- **Android**: real blur requires **API 31+** (`RenderEffect`). Below API 31 there is no CPU blur
  fallback by design (plan §44) — the view instead renders `fallbackColor` as a flat color. Set a
  `fallbackColor` close to your intended blurred backdrop's average color so older devices still
  look reasonable.
- iOS "Reduce Transparency" (accessibility) forces the same `fallbackColor` fallback path on iOS,
  for the same reason system blur is disabled there.

## Quick start

```tsx
import { BlurView } from 'react-native-parity-blur';

function BottomSheet() {
  return (
    <BlurView
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 280 }}
      blurRadius={20}
      overlayColor="rgba(16,16,16,0.35)"
      saturation={1.4}
      fallbackColor="rgba(20,20,20,0.92)"
    >
      <Text>Sharp content on top of a blurred backdrop</Text>
    </BlurView>
  );
}
```

By default (`mode="static"`), the backdrop is captured once — on mount and on layout/relevant-prop
changes — and presented as a still blurred snapshot. If content behind the view changes afterward
without a layout change, call `refresh()` (see below) or switch to `mode="live"`.

## The canonical unit: `blurRadius`

`blurRadius` is a **Gaussian sigma expressed in dp** (density-independent pixels — iOS `pt` and
Android `dp` are treated as the same unit). It is *not* a platform-native blur-radius parameter:
internally it's converted to whatever each backend's real API expects (Android's `RenderEffect`
radius, iOS's MPS sigma — see docs/PIPELINE_SPEC.md §2), so you write one number and get a
calibrated, matching blur weight on both platforms. There is no "roughly similar" — see
[Parity](#parity) below for the measured numbers.

## Props

| Prop | Type | Default | Semantics |
|---|---|---|---|
| `blurRadius` | `number` | `0` | Gaussian sigma in dp — the canonical cross-platform blur unit (see above). `0` (or omitted) renders no blur. Negative/non-finite values clamp to `0` with a DEV warning. |
| `mode` | `'static' \| 'live'` | `'static'` | `'static'` captures the backdrop once (mount/layout/relevant-prop change) and shows a still snapshot — call `refresh()` after further backdrop changes. `'live'` recaptures continuously, throttled by `maxFps`, while the view is visible. |
| `preset` | `BlurPresetName` | none | Named material-like preset (see [Presets](#presets)) resolved client-side to `{ blurRadius, saturation, overlayColor }` before this component's own explicit props are layered on top. Pure JS sugar — no native prop is added. |
| `overlayColor` | `string` (color) | `'transparent'` | Straight-alpha color composited source-over the blurred + saturated result — the only tint anywhere in the pipeline (no hidden per-platform tint). Unparseable colors resolve to "no overlay" with a DEV warning. |
| `saturation` | `number` | `1` | Post-blur, pre-overlay saturation multiplier: `1` = unchanged, `0` = Rec.709 grayscale, `>1` = boosted. Negative/non-finite values clamp to `1` with a DEV warning. |
| `quality` | `'high' \| 'balanced' \| 'performance'` | `'balanced'` | Biases automatic downsample selection: `high` prefers 1×/2× snapshots, `balanced` prefers 2×/4×, `performance` prefers 4×/8×. No effect when `downsample` is an explicit number. |
| `downsample` | `'auto' \| 1 \| 2 \| 4 \| 8` | `'auto'` | Snapshot downsample factor. `'auto'` derives a factor from sigma, capture area, and `quality`; an explicit factor overrides selection for advanced tuning. |
| `maxFps` | `number` | `30` | Upper bound on live-mode recapture rate. Ignored in `'static'` mode. Clamped to `[1, 120]` with a DEV warning outside that range. |
| `fallbackColor` | `string` (color) | none | Color rendered instead of real blur wherever real blur is unavailable (Android < API 31, or "Reduce Transparency" on either platform). No effect where real blur runs. If unset, the fallback path renders fully transparent. |
| `blurTarget` | `React.RefObject<any>` | none | **Not implemented in v1** — accepted only to keep the public API shape stable; passing it currently has no effect. See [Known limitations](docs/LIMITATIONS.md). Planned for v1.1. |
| `children` | `React.ReactNode` | — | Rendered on top of the blur, unaffected by it. |
| `style` | `StyleProp<ViewStyle>` | — | Standard RN view style. `borderRadius` (and other clip styles) clip the blur output itself, not just the children. |

Imperative ref:

```tsx
const blurRef = useRef<BlurViewRef>(null);
// ...
<BlurView ref={blurRef} mode="static" blurRadius={20}>
  {children}
</BlurView>
// later, after the backdrop behind it changed:
blurRef.current?.refresh();
```

`refresh()` schedules a coalesced recapture on the next valid frame — it is a real, fully wired
native command on both platforms (not a stub). Repeated calls before the pending capture runs
coalesce into a single recapture, so it's safe to call from scroll/animation callbacks.

## Presets

A preset is nothing more than a fixed `{ blurRadius, saturation, overlayColor }` bundle — plain
public props, no hidden or platform-specific backend behavior (plan §11). Spread one directly:

```tsx
import { BlurPresets } from 'react-native-parity-blur';

<BlurView {...BlurPresets.dark} style={styles.sheet}>
  {children}
</BlurView>
```

or pass the name via the `preset` prop, still overridable per-field:

```tsx
<BlurView preset="dark" blurRadius={30} style={styles.sheet}>
  {children}
</BlurView>
```

Available presets: `ultraThin`, `thin`, `regular`, `thick`, `chrome`, `light`, `dark`. These are
deterministic approximations of common material "weights" (inspired by, but not measured against,
iOS system materials) — see `src/presets.ts` for the exact values and rationale. Because
`blurRadius`/`saturation`/`overlayColor` are calibrated cross-platform, any preset renders the same
on iOS and Android.

## Static vs. live mode

- **`mode="static"`** (default): capture happens once, then the blurred result is a cheap static
  presentation with no ongoing per-frame cost — measured at **0 rendered frames over 6s of idle
  time** on Android (docs/HARDENING_REPORT.md). Use this for bottom sheets, modals, and any
  backdrop that only changes on discrete events (call `refresh()` after those events).
- **`mode="live"`** continuously recaptures the backdrop, throttled to `maxFps` (default 30) and
  paused automatically when the view isn't visible. Use this for blur over actively scrolling or
  animating content (e.g. a blurred header above a scrolling list). It costs strictly more than
  static — see [Performance](docs/PERFORMANCE.md) for measured numbers and when the extra cost is
  and isn't worth it, and note iOS live is the more expensive of the two platforms' live paths.

## Parity

Measured on physical devices (Android Pixel 6a API 36, iOS iPhone 14 Pro) across 5 blur radii × 6
color/contrast fixtures × clear/tinted variants — 110 valid strip comparisons
(docs/CALIBRATION_REPORT.md):

| Metric | Worst observed | Notes |
|---|---|---|
| Per-strip mean ΔE76 (color) | **0.90** | at σ=32dp on a full-frame luminance ramp (screen-edge capture-support truncation); every other strip ≤ 0.64 |
| Per-strip SSIM (structural similarity) | **0.983** | same worst-case strip; all others ≥ 0.995 |
| Edge-crossing displacement | ≤ 0.96 dp | sub-pixel on both device rasters |
| Overlay/saturation tint residual | ≤ 1.45 /255 | confirms the overlay and saturation math match on both platforms |
| Convolution color space | gamma-space on both | confirmed via a checkerboard gamma-midpoint discriminator |

The framing is deliberately "perceptually matched within documented tolerance," not pixel-identical
— exact pixel identity isn't guaranteed (and isn't the goal) across OS versions, GPU vendors, and
device scales. See docs/CALIBRATION_REPORT.md for the full methodology and per-fixture breakdown,
and docs/PIPELINE_SPEC.md for the locked pipeline both backends implement.

## Known limitations & performance

- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — cross-window/Modal capture, surface-backed content
  (video/camera/maps), static-mode staleness, iOS live cost, nested-blur semantics, `blurTarget`
  status, and more.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md) — measured frame/GPU costs, static-vs-live guidance,
  downsample/quality tuning, `maxFps` guidance.
- [docs/PIPELINE_SPEC.md](docs/PIPELINE_SPEC.md) — the normative, language-neutral pipeline spec
  both native backends implement.
- [docs/CALIBRATION_REPORT.md](docs/CALIBRATION_REPORT.md) — the full parity measurement report.

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
