/**
 * Locked calibration constants for the canonical pipeline.
 *
 * INTERNAL MODULE. These are the single source of truth for the reference
 * implementation. Native backends must mirror these exact values. Per the
 * plan (§5.2, §38) constants remain provisional until the parity milestone,
 * but M0 device verification already confirmed the HWUI relation on API 36.
 */

/**
 * HWUI RenderEffect Gaussian relation, verified exact on a Pixel 6a (API 36)
 * in M0: `sigma = HWUI_SIGMA_SLOPE * radiusPlatform + HWUI_SIGMA_INTERCEPT`.
 * Isolated here so a future version-aware calibration can override it in one
 * place (plan §5.2). Do NOT inline these anywhere else.
 */
export const HWUI_SIGMA_SLOPE = 0.57735;
export const HWUI_SIGMA_INTERCEPT = 0.5;

/**
 * Below this snapshot-domain sigma the Android RenderEffect relation inverts
 * to a non-positive radius, so we emit a no-blur passthrough instead. Equal to
 * HWUI_SIGMA_INTERCEPT by construction (radius 0 <=> sigma 0.5).
 */
export const ANDROID_MIN_BLUR_SIGMA = HWUI_SIGMA_INTERCEPT;

/** Gaussian support multiplier for capture expansion (plan §7). */
export const CAPTURE_SUPPORT_K = 3;

/**
 * Auto-downsample: target lower bound on snapshot-domain sigma. Keeping
 * sigmaSnapshot at or above this prevents over-downsampling that would make
 * the kernel degenerate (plan §12). 1 snapshot px.
 */
export const MIN_SIGMA_SNAPSHOT = 1.0;

/**
 * Auto-downsample: captures with area (device px^2) below this are considered
 * "small" and are never downsampled beyond 2x — aggressive reduction of a tiny
 * region buys no meaningful performance while degrading quality.
 * 256 * 256 device px.
 */
export const SMALL_CAPTURE_AREA_PX = 256 * 256;

/**
 * Auto-downsample: per-quality ceiling on the downsample factor (plan §13).
 *   high        -> prefer 1x or 2x
 *   balanced    -> prefer 2x or 4x
 *   performance -> prefer 4x or 8x
 */
export const QUALITY_MAX_DOWNSAMPLE: Record<
  'high' | 'balanced' | 'performance',
  1 | 2 | 4 | 8
> = {
  high: 2,
  balanced: 4,
  performance: 8,
};

/**
 * Rec. 709 luminance coefficients (plan §10). Sum to 1.0. Used for the
 * saturation matrix on both platforms.
 */
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;
