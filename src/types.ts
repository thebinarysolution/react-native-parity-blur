import type * as React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import type { BlurPresetName } from './presets';

/** Public blur mode (plan §20/§21). default: 'static'. */
export type BlurMode = 'static' | 'live';

/** Public quality tier (plan §13). default: 'balanced'. */
export type BlurQuality = 'high' | 'balanced' | 'performance';

/** Public downsample selector (plan §12). default: 'auto'. */
export type BlurDownsample = 'auto' | 1 | 2 | 4 | 8;

export interface BlurViewProps {
  /**
   * Gaussian sigma in dp (plan §5.1) — the same canonical unit on both
   * platforms (iOS pt ≡ Android dp semantically). Internally converted to
   * each native backend's own blur parameter (docs/PIPELINE_SPEC.md §2), so
   * the same number produces calibrated matching visual weight on iOS and
   * Android (worst measured ΔE76 0.90, SSIM ≥ 0.983 across the parity
   * suite — docs/CALIBRATION_REPORT.md). `0` (or omitted) renders no blur.
   * Non-finite or negative values clamp to 0 with a DEV warning.
   * default: 0.
   */
  blurRadius?: number;

  /**
   * `'static'` captures the backdrop once (on mount, layout change, or a
   * prop change that affects the capture) and presents a still blurred
   * snapshot; call `refresh()` to recapture after the backdrop changes
   * underneath it. `'live'` recaptures continuously (throttled by
   * `maxFps`) while the view is on screen. default: 'static'.
   */
  mode?: BlurMode;

  /**
   * Named material-like preset (plan §11) resolved client-side to a base
   * `{ blurRadius, saturation, overlayColor }` bundle before this
   * component's own explicit props are applied on top — see
   * `BlurPresets`/`BlurPresetName` in `presets.ts` for the exact values.
   * Pure JS convenience: it does not add a native prop, and any of those
   * three props passed explicitly alongside `preset` overrides the
   * preset's value for that prop only. default: none.
   */
  preset?: BlurPresetName;

  /**
   * Straight-alpha color composited source-over the blurred + saturated
   * result (docs/PIPELINE_SPEC.md §8) — the only tint anywhere in the
   * pipeline; there is no hidden per-platform tint. An unparseable color
   * resolves to "no overlay" with a DEV warning. default: 'transparent'
   * (no overlay).
   */
  overlayColor?: string;

  /**
   * Post-blur saturation multiplier (docs/PIPELINE_SPEC.md §7), applied
   * after blur and before the overlay: `1` = unchanged, `0` = Rec.709
   * grayscale, values `> 1` boost saturation. Negative or non-finite values
   * clamp to the default with a DEV warning. default: 1.
   */
  saturation?: number;

  /**
   * Consumer-friendly quality tier that biases automatic downsample
   * selection (plan §13): `'high'` prefers 1x/2x snapshots, `'balanced'`
   * prefers 2x/4x, `'performance'` prefers 4x/8x. Has no effect when
   * `downsample` is an explicit numeric override. default: 'balanced'.
   */
  quality?: BlurQuality;

  /**
   * Snapshot downsample factor (plan §12). `'auto'` derives a factor from
   * requested sigma, capture area, and `quality` (docs/PIPELINE_SPEC.md
   * §4); `1 | 2 | 4 | 8` forces that exact factor for advanced tuning.
   * default: 'auto'.
   */
  downsample?: BlurDownsample;

  /**
   * Upper bound on live-mode recapture rate, in frames per second. Ignored
   * in `'static'` mode. Clamped to `[1, 120]` with a DEV warning outside
   * that range. default: 30.
   */
  maxFps?: number;

  /**
   * Color rendered in place of a real blur wherever real blur is
   * unavailable: Android below API 31 (no `RenderEffect`) or, on either
   * platform, when the OS-level "Reduce Transparency" accessibility
   * setting is on. Has no effect on a device/OS combination where real
   * blur runs. default: none (renders fully transparent when the fallback
   * path is active and no `fallbackColor` is set).
   */
  fallbackColor?: string;

  /**
   * Target view whose subtree should be captured as the blur backdrop,
   * instead of the default (the content behind this `BlurView` within its
   * own window) (plan §18). **Not implemented in v1** — accepted only to
   * keep the public API shape stable for a later release; passing it
   * currently has no native-side effect. Deferred to v1.1 — see
   * docs/LIMITATIONS.md.
   */
  blurTarget?: React.RefObject<any>;

  /** Content rendered on top of the blur; unaffected by it. */
  children?: React.ReactNode;

  /**
   * Standard React Native view style. `borderRadius` (and other clipping
   * styles) clip the blur output itself, not just the children (plan §31).
   */
  style?: StyleProp<ViewStyle>;
}

/**
 * Imperative handle exposed via ref (plan §29).
 */
export interface BlurViewRef {
  /**
   * Schedules a coalesced recapture of the backdrop on the next valid
   * frame — fully implemented end-to-end on both native backends (not a
   * no-op). Repeated calls before the pending capture runs coalesce into a
   * single recapture. Primarily useful in `mode="static"` after the
   * backdrop has changed; in `mode="live"` the view is already recapturing
   * continuously, so `refresh()` has no additional effect beyond nudging
   * the next scheduled frame.
   */
  refresh(): void;
}
