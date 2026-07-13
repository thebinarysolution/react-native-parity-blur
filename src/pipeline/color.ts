/**
 * Color parsing for the overlay prop.
 *
 * INTERNAL MODULE. Parses the subset of CSS color syntaxes React Native
 * accepts for a string color prop into straight-alpha RGBA in [0,1]:
 *   - 'transparent'
 *   - #rgb / #rgba / #rrggbb / #rrggbbaa
 *   - rgb(r,g,b) / rgba(r,g,b,a)   (r,g,b integer 0-255, a float 0-1)
 *
 * Any unrecognised value returns a fully-transparent color (no overlay), which
 * is the documented default (plan §11). The native backends parse the same
 * prop with their platform color parsers; this reference fixes the expected
 * numeric result for parity fixtures.
 */

import type { RGBA } from './types';

export const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function hexPair(s: string): number {
  return parseInt(s, 16) / 255;
}

/** Parse a color string into straight-alpha RGBA. Unrecognised -> transparent. */
export function parseColor(input: string | null | undefined): RGBA {
  if (input == null) return TRANSPARENT;
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return TRANSPARENT;

  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = hexPair(hex[0]! + hex[0]!);
      const g = hexPair(hex[1]! + hex[1]!);
      const b = hexPair(hex[2]! + hex[2]!);
      const a = hex.length === 4 ? hexPair(hex[3]! + hex[3]!) : 1;
      return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = hexPair(hex.slice(0, 2));
      const g = hexPair(hex.slice(2, 4));
      const b = hexPair(hex.slice(4, 6));
      const a = hex.length === 8 ? hexPair(hex.slice(6, 8)) : 1;
      return { r, g, b, a };
    }
    return TRANSPARENT;
  }

  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1]!.split(',').map((p) => p.trim());
    if (parts.length === 3 || parts.length === 4) {
      const r = clamp01(parseFloat(parts[0]!) / 255);
      const g = clamp01(parseFloat(parts[1]!) / 255);
      const b = clamp01(parseFloat(parts[2]!) / 255);
      const a = parts.length === 4 ? clamp01(parseFloat(parts[3]!)) : 1;
      if ([r, g, b, a].every((v) => Number.isFinite(v))) return { r, g, b, a };
    }
  }

  return TRANSPARENT;
}
