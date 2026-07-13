/**
 * Auto downsample selection (plan §12, §13).
 *
 * INTERNAL MODULE. Deterministic function of (sigmaPx, captureAreaPx, quality)
 * -> D in {1,2,4,8}. Both backends must select identically for identical input.
 *
 * The chosen factor is the largest allowed value that satisfies ALL of three
 * independent ceilings, then snapped down to a real factor in {1,2,4,8}:
 *
 *   1. quality ceiling   — QUALITY_MAX_DOWNSAMPLE[quality]
 *   2. sigma floor        — keep sigmaSnapshot = sigmaPx / D >= MIN_SIGMA_SNAPSHOT,
 *                            i.e. D <= floor(sigmaPx / MIN_SIGMA_SNAPSHOT)
 *   3. area ceiling       — tiny captures (< SMALL_CAPTURE_AREA_PX) never exceed 2x
 *
 * See docs/PIPELINE_SPEC.md for the locked decision table.
 */

import {
  MIN_SIGMA_SNAPSHOT,
  QUALITY_MAX_DOWNSAMPLE,
  SMALL_CAPTURE_AREA_PX,
} from './constants';
import type { BlurDownsample, BlurQuality, Downsample } from './types';
import { DOWNSAMPLE_FACTORS } from './types';

/** Largest allowed factor in {8,4,2,1} that is <= cap (never below 1). */
function largestFactorAtMost(cap: number): Downsample {
  for (const factor of DOWNSAMPLE_FACTORS) {
    if (factor <= cap) return factor;
  }
  return 1;
}

/**
 * Resolve the auto-selected downsample factor.
 *
 * @param sigmaPx      device-pixel sigma (blurRadius * displayScale)
 * @param captureAreaPx expanded capture area in device px^2
 * @param quality      quality tier
 */
export function autoDownsample(
  sigmaPx: number,
  captureAreaPx: number,
  quality: BlurQuality
): Downsample {
  // No blur requested -> never downsample.
  if (!Number.isFinite(sigmaPx) || sigmaPx <= 0) return 1;

  const maxByQuality = QUALITY_MAX_DOWNSAMPLE[quality];

  // Sigma floor: keep snapshot sigma at/above the minimum useful value.
  const maxBySigma = Math.floor(sigmaPx / MIN_SIGMA_SNAPSHOT);

  // Area ceiling: small captures are capped at 2x.
  const area = Number.isFinite(captureAreaPx) ? captureAreaPx : 0;
  const maxByArea = area < SMALL_CAPTURE_AREA_PX ? 2 : 8;

  const cap = Math.min(maxByQuality, maxBySigma, maxByArea);
  return largestFactorAtMost(cap);
}

/**
 * Resolve a public `downsample` prop to a concrete factor. An explicit numeric
 * value is honoured verbatim; 'auto' delegates to {@link autoDownsample}.
 */
export function resolveDownsample(
  prop: BlurDownsample,
  sigmaPx: number,
  captureAreaPx: number,
  quality: BlurQuality
): Downsample {
  if (prop === 'auto') return autoDownsample(sigmaPx, captureAreaPx, quality);
  return prop;
}
