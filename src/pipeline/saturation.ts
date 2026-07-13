/**
 * Saturation color matrix (plan §10).
 *
 * INTERNAL MODULE. One canonical 4x5 color matrix (Android ColorMatrix layout:
 * 4 output rows R,G,B,A; 5 columns R,G,B,A,offset) using Rec.709 luminance
 * coefficients. Applied AFTER blur, BEFORE overlay (plan §6 step 9).
 *
 * For saturation s and luma coefficients (lr,lg,lb) with t = 1 - s:
 *
 *   R' = (t*lr + s)*R +  t*lg*G     +  t*lb*B
 *   G' =  t*lr*R     + (t*lg + s)*G +  t*lb*B
 *   B' =  t*lr*R     +  t*lg*G      + (t*lb + s)*B
 *   A' = A
 *
 *   s = 1 -> identity;  s = 0 -> luminance grayscale;  s > 1 -> more saturated.
 *
 * The alpha row is untouched and there is no offset column (all offsets 0).
 * The matrix operates on the same channel representation the backend blurs in
 * (gamma-space, straight color for the opaque v1 backdrop). It does NOT itself
 * premultiply — see docs/PIPELINE_SPEC.md §Color.
 */

import { LUMA_B, LUMA_G, LUMA_R } from './constants';

/**
 * Row-major 4x5 saturation matrix (20 numbers), matching Android's
 * ColorMatrix and directly transcribable to a Metal 4x4 + bias.
 */
export function saturationMatrix(
  s: number,
  lr: number = LUMA_R,
  lg: number = LUMA_G,
  lb: number = LUMA_B
): number[] {
  const t = 1 - s;
  return [
    t * lr + s,
    t * lg,
    t * lb,
    0,
    0,
    t * lr,
    t * lg + s,
    t * lb,
    0,
    0,
    t * lr,
    t * lg,
    t * lb + s,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
}

/**
 * Apply a 4x5 saturation matrix to a straight-alpha RGBA tuple (channels in
 * [0,1]). Returned RGB is clamped to [0,1]; alpha is passed through untouched.
 * Reference for backend parity tests.
 */
export function applySaturation(
  matrix: number[],
  r: number,
  g: number,
  b: number,
  a: number
): { r: number; g: number; b: number; a: number } {
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const m = matrix;
  return {
    // Indices per row-major 4x5 layout.
    r: clamp01(m[0]! * r + m[1]! * g + m[2]! * b + m[3]! * a + m[4]!),
    g: clamp01(m[5]! * r + m[6]! * g + m[7]! * b + m[8]! * a + m[9]!),
    b: clamp01(m[10]! * r + m[11]! * g + m[12]! * b + m[13]! * a + m[14]!),
    a: m[15]! * r + m[16]! * g + m[17]! * b + m[18]! * a + m[19]!,
  };
}
