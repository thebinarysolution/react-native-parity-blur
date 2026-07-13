/**
 * Android RenderEffect calibration (plan §5.2).
 *
 * INTERNAL MODULE. The single place the HWUI sigma<->radius relation lives on
 * the TypeScript side; the Kotlin `AndroidBlurCalibration` must mirror it
 * exactly. Verified on a Pixel 6a (API 36) in M0: radiusForSigma(10) exactly
 * equals 16.454486... (matching the on-device measurement 16.45449).
 *
 * Relation (HWUI):  sigma = SLOPE * radiusPlatform + INTERCEPT
 * Inverse:          radiusPlatform = (sigma - INTERCEPT) / SLOPE
 *
 * When sigmaSnapshot <= INTERCEPT (0.5) the inverse is non-positive, so we
 * clamp to a no-blur passthrough rather than feeding a bogus radius to
 * RenderEffect.createBlurEffect (plan §5.2 "no-op blur" for very small sigma).
 */

import {
  ANDROID_MIN_BLUR_SIGMA,
  HWUI_SIGMA_INTERCEPT,
  HWUI_SIGMA_SLOPE,
} from './constants';

export interface AndroidBlurParam {
  /** True when the requested blur collapses to a no-op passthrough. */
  noBlur: boolean;
  /**
   * Platform radius to pass to RenderEffect.createBlurEffect. 0 when noBlur.
   * Always >= 0.
   */
  radiusPlatform: number;
}

/**
 * Forward relation, exposed for tests/verification: the sigma that HWUI
 * produces for a given platform radius.
 */
export function sigmaForRadius(radiusPlatform: number): number {
  return HWUI_SIGMA_SLOPE * radiusPlatform + HWUI_SIGMA_INTERCEPT;
}

/**
 * Inverse relation: the platform radius required to achieve a target
 * snapshot-domain sigma. Below the intercept this returns a no-blur result.
 * Monotonically non-decreasing in sigmaSnapshot.
 */
export function radiusForSigma(sigmaSnapshot: number): AndroidBlurParam {
  if (
    !Number.isFinite(sigmaSnapshot) ||
    sigmaSnapshot <= ANDROID_MIN_BLUR_SIGMA
  ) {
    return { noBlur: true, radiusPlatform: 0 };
  }
  return {
    noBlur: false,
    radiusPlatform: (sigmaSnapshot - HWUI_SIGMA_INTERCEPT) / HWUI_SIGMA_SLOPE,
  };
}

/**
 * iOS MPSImageGaussianBlur takes the snapshot-domain sigma directly (plan §5.3).
 * Provided here for symmetry so both platform mappings live in the reference.
 * Sigma at or below 0 means no blur.
 */
export function iosSigmaForSigma(sigmaSnapshot: number): number {
  if (!Number.isFinite(sigmaSnapshot) || sigmaSnapshot <= 0) return 0;
  return sigmaSnapshot;
}
