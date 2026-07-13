/**
 * Canonical unit conversions (plan §5.1).
 *
 * INTERNAL MODULE. Pure functions, no side effects, no react-native imports.
 *
 *   blurRadius   = Gaussian sigma in dp (public unit)
 *   sigmaPx      = blurRadius * displayScale         (device pixels)
 *   sigmaSnapshot= sigmaPx / D                        (downsampled snapshot px)
 *
 * The blur backend always receives a parameter derived from sigmaSnapshot.
 */

import type { Downsample } from './types';

/**
 * Convert the public blurRadius (sigma in dp) to sigma in device pixels.
 * Non-finite or negative inputs clamp to 0 (plan §28 safe clamping).
 */
export function sigmaPxFromDp(
  blurRadiusDp: number,
  displayScale: number
): number {
  if (!Number.isFinite(blurRadiusDp) || blurRadiusDp <= 0) return 0;
  if (!Number.isFinite(displayScale) || displayScale <= 0) return 0;
  return blurRadiusDp * displayScale;
}

/**
 * Convert device-pixel sigma to snapshot-domain sigma given a downsample
 * factor D. D is a positive integer in {1,2,4,8}.
 */
export function sigmaSnapshotFromPx(
  sigmaPx: number,
  downsample: Downsample
): number {
  if (!Number.isFinite(sigmaPx) || sigmaPx <= 0) return 0;
  return sigmaPx / downsample;
}
