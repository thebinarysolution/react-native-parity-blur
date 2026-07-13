/**
 * Material-like presets (plan §11, plan §41 / Milestone 8).
 *
 * A preset is nothing more than a fixed, explicit
 * `{ blurRadius, saturation, overlayColor }` prop bundle. There is no
 * hidden or platform-specific behavior: applying `BlurPresets.dark` is
 * exactly equivalent to spreading that plain object onto `<BlurView>`
 * yourself, and the resulting three numbers/strings go through the same
 * calibrated pipeline as any other explicit props (docs/PIPELINE_SPEC.md).
 * Because blurRadius/saturation/overlayColor are calibrated to match
 * cross-platform (docs/CALIBRATION_REPORT.md — worst measured ΔE76 0.90,
 * SSIM ≥ 0.983), a given preset renders the same on iOS and Android.
 *
 * These are *approximations* of the visual weight of iOS system materials
 * (UIBlurEffect styles), chosen by eye against reasonable blurRadius /
 * saturation / overlayColor values — they are not derived from, measured
 * against, or guaranteed to match `UIVisualEffectView` output, and Android
 * has no equivalent native material to match at all. Treat the names as a
 * starting point, not a parity claim (plan §43 — nested/material stacking
 * is deterministic, not an Apple material emulation).
 *
 * Usage:
 * ```tsx
 * <BlurView {...BlurPresets.dark} style={styles.sheet}>
 *   {children}
 * </BlurView>
 * ```
 *
 * Every field is a plain public prop, so you can still override any one of
 * them by spreading the preset first and your own prop second:
 * ```tsx
 * <BlurView {...BlurPresets.dark} blurRadius={30} />
 * ```
 *
 * Or, for the same effect without spreading, pass the `preset` prop
 * directly to `<BlurView>` (`src/BlurView.tsx`) — it resolves to this same
 * object client-side before any explicit blurRadius/saturation/overlayColor
 * prop is applied on top of it. Both forms are pure JS convenience; neither
 * adds a native prop.
 */

/** One named preset: an explicit bundle of public BlurView props. */
export interface BlurPreset {
  /** Gaussian sigma in dp — see `BlurViewProps.blurRadius`. */
  blurRadius: number;
  /** See `BlurViewProps.saturation`. */
  saturation: number;
  /** See `BlurViewProps.overlayColor`. */
  overlayColor: string;
}

/** Keys of {@link BlurPresets}. */
export type BlurPresetName =
  'ultraThin' | 'thin' | 'regular' | 'thick' | 'chrome' | 'light' | 'dark';

/**
 * Named material-like preset table. See the module doc comment above for
 * semantics and the "not a parity claim" caveat.
 */
export const BlurPresets: Readonly<Record<BlurPresetName, BlurPreset>> = {
  /** Barely-there frosted glass: minimal blur, faint light tint. */
  ultraThin: {
    blurRadius: 10,
    saturation: 1.3,
    overlayColor: 'rgba(255,255,255,0.15)',
  },
  /** Light frosted glass, subtle. */
  thin: {
    blurRadius: 14,
    saturation: 1.4,
    overlayColor: 'rgba(255,255,255,0.25)',
  },
  /** Neutral, medium-weight — a reasonable default over photos/color. */
  regular: {
    blurRadius: 20,
    saturation: 1.2,
    overlayColor: 'rgba(128,128,128,0.16)',
  },
  /** Heavier blur, more opaque neutral-dark tint. */
  thick: {
    blurRadius: 28,
    saturation: 1.3,
    overlayColor: 'rgba(20,20,20,0.35)',
  },
  /** Near-opaque, low-saturation — for toolbar/nav-bar-like surfaces. */
  chrome: {
    blurRadius: 24,
    saturation: 1.1,
    overlayColor: 'rgba(230,230,230,0.55)',
  },
  /** Classic light material: strong blur, warm-white tint, boosted saturation. */
  light: {
    blurRadius: 20,
    saturation: 1.8,
    overlayColor: 'rgba(255,255,255,0.4)',
  },
  /** Classic dark material: strong blur, near-black tint, boosted saturation. */
  dark: {
    blurRadius: 20,
    saturation: 1.5,
    overlayColor: 'rgba(16,16,16,0.45)',
  },
};
