/**
 * Overlay source-over compositing (plan §11).
 *
 * INTERNAL MODULE. The overlay color (straight alpha, parsed from the prop) is
 * the SOURCE; the saturated blur result is the DESTINATION. Applied AFTER
 * saturation, BEFORE final clipping (plan §6 step 10). This is the only tint in
 * the pipeline — no hidden platform tint is permitted.
 *
 * Straight-alpha (non-premultiplied) source-over, per channel:
 *
 *   outA = srcA + dstA * (1 - srcA)
 *   outC = (srcC*srcA + dstC*dstA*(1 - srcA)) / outA    (outA > 0)
 *          0                                             (outA = 0)
 *
 * In v1 the capture surface is an opaque backdrop, so dstA = 1 and this reduces
 * to the familiar linear blend  outC = srcC*srcA + dstC*(1 - srcA), outA = 1.
 * The general form is implemented so the reference stays correct if a future
 * version captures translucent backdrops.
 */

import type { RGBA } from './types';

/**
 * Source-over composite of a straight-alpha source over a straight-alpha
 * destination. Returns straight-alpha RGBA.
 */
export function sourceOver(src: RGBA, dst: RGBA): RGBA {
  const outA = src.a + dst.a * (1 - src.a);
  if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const blend = (sc: number, dc: number) =>
    (sc * src.a + dc * dst.a * (1 - src.a)) / outA;
  return {
    r: blend(src.r, dst.r),
    g: blend(src.g, dst.g),
    b: blend(src.b, dst.b),
    a: outA,
  };
}

/**
 * Convenience: composite an overlay color over an opaque (alpha=1) blurred
 * pixel — the v1 case. Equivalent to sourceOver(overlay, {..dst, a:1}).
 */
export function overlayOnOpaque(overlay: RGBA, dst: RGBA): RGBA {
  return sourceOver(overlay, { r: dst.r, g: dst.g, b: dst.b, a: 1 });
}
