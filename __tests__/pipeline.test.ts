/**
 * Canonical pipeline reference tests (Milestone 2).
 *
 * Runs the pure TypeScript reference (src/pipeline) against the language-neutral
 * fixture table (test/pipeline-fixtures.json) that the native M3/M4 suites will
 * also consume, plus property checks that pin the invariants the spec promises.
 *
 * No react-native imports here, so this runs under the RN jest preset without
 * needing a separate project config.
 */

import { describe, expect, it } from '@jest/globals';

import {
  autoDownsample,
  cropRectFor,
  cropRectToViewPx,
  expandCaptureRect,
  parseColor,
  radiusForSigma,
  saturationMatrix,
  sigmaForRadius,
  sigmaPxFromDp,
  sigmaSnapshotFromPx,
  snapshotRectFor,
  sourceOver,
  supportMarginPx,
  type Downsample,
  type Rect,
  type BlurQuality,
} from '../src/pipeline';
import fixtures from '../test/pipeline-fixtures.json';

const EPS = 1e-9;

const expectRectClose = (actual: Rect, expected: Rect) => {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.width).toBeCloseTo(expected.width, 9);
  expect(actual.height).toBeCloseTo(expected.height, 9);
};

describe('fixture: sigmaPxFromDp', () => {
  for (const c of fixtures.sigmaPxFromDp) {
    it(`dp=${c.blurRadiusDp} scale=${c.displayScale} -> ${c.expected}`, () => {
      expect(sigmaPxFromDp(c.blurRadiusDp, c.displayScale)).toBeCloseTo(
        c.expected,
        9
      );
    });
  }
});

describe('fixture: sigmaSnapshotFromPx', () => {
  for (const c of fixtures.sigmaSnapshotFromPx) {
    it(`px=${c.sigmaPx} D=${c.downsample} -> ${c.expected}`, () => {
      expect(
        sigmaSnapshotFromPx(c.sigmaPx, c.downsample as Downsample)
      ).toBeCloseTo(c.expected, 9);
    });
  }
});

describe('fixture: radiusForSigma', () => {
  for (const c of fixtures.radiusForSigma) {
    it(`sigma=${c.sigmaSnapshot}`, () => {
      const r = radiusForSigma(c.sigmaSnapshot);
      expect(r.noBlur).toBe(c.expected.noBlur);
      expect(r.radiusPlatform).toBeCloseTo(c.expected.radiusPlatform, 9);
    });
  }
});

describe('fixture: autoDownsample', () => {
  for (const c of fixtures.autoDownsample) {
    it(`px=${c.sigmaPx} area=${c.captureAreaPx} q=${c.quality} -> ${c.expected}`, () => {
      expect(
        autoDownsample(c.sigmaPx, c.captureAreaPx, c.quality as BlurQuality)
      ).toBe(c.expected);
    });
  }
});

describe('fixture: supportMarginPx', () => {
  for (const c of fixtures.supportMarginPx) {
    it(`px=${c.sigmaPx} -> ${c.expected}`, () => {
      expect(supportMarginPx(c.sigmaPx)).toBe(c.expected);
    });
  }
});

describe('fixture: expandCaptureRect', () => {
  fixtures.expandCaptureRect.forEach((c, i) => {
    it(`case ${i}`, () => {
      expectRectClose(
        expandCaptureRect(c.visibleRect, c.targetBounds, c.sigmaPx),
        c.expected
      );
    });
  });
});

describe('fixture: snapshotRectFor', () => {
  fixtures.snapshotRectFor.forEach((c, i) => {
    it(`case ${i}`, () => {
      expectRectClose(
        snapshotRectFor(c.captureRectPx, c.downsample as Downsample),
        c.expected
      );
    });
  });
});

describe('fixture: cropRectFor', () => {
  fixtures.cropRectFor.forEach((c, i) => {
    it(`case ${i}`, () => {
      const snap = snapshotRectFor(c.captureRectPx, c.downsample as Downsample);
      expectRectClose(
        cropRectFor(c.visibleRect, snap, c.downsample as Downsample),
        c.expected
      );
    });
  });
});

describe('fixture: saturationMatrix', () => {
  for (const c of fixtures.saturationMatrix) {
    it(`s=${c.s}`, () => {
      const m = saturationMatrix(c.s);
      expect(m).toHaveLength(20);
      m.forEach((v, i) => expect(v).toBeCloseTo(c.expected[i]!, 9));
    });
  }
});

describe('fixture: parseColor', () => {
  for (const c of fixtures.parseColor) {
    it(`${c.input}`, () => {
      const got = parseColor(c.input);
      expect(got.r).toBeCloseTo(c.expected.r, 9);
      expect(got.g).toBeCloseTo(c.expected.g, 9);
      expect(got.b).toBeCloseTo(c.expected.b, 9);
      expect(got.a).toBeCloseTo(c.expected.a, 9);
    });
  }
});

describe('fixture: sourceOver', () => {
  fixtures.sourceOver.forEach((c, i) => {
    it(`case ${i}`, () => {
      const got = sourceOver(c.src, c.dst);
      expect(got.r).toBeCloseTo(c.expected.r, 9);
      expect(got.g).toBeCloseTo(c.expected.g, 9);
      expect(got.b).toBeCloseTo(c.expected.b, 9);
      expect(got.a).toBeCloseTo(c.expected.a, 9);
    });
  });
});

// --- property checks (plan invariants) ---

describe('property: radiusForSigma monotonic in sigma', () => {
  it('non-decreasing above the no-blur threshold', () => {
    let prev = -Infinity;
    for (let sigma = 0.5; sigma <= 60; sigma += 0.25) {
      const { radiusPlatform } = radiusForSigma(sigma);
      expect(radiusPlatform).toBeGreaterThanOrEqual(prev - EPS);
      prev = radiusPlatform;
    }
  });

  it('inverse of sigmaForRadius', () => {
    for (let radius = 0; radius <= 100; radius += 3) {
      const sigma = sigmaForRadius(radius);
      const back = radiusForSigma(sigma);
      expect(back.radiusPlatform).toBeCloseTo(radius, 6);
    }
  });
});

describe('property: autoDownsample keeps sigmaSnapshot >= 0.5 unless sigmaPx itself is', () => {
  const qualities: BlurQuality[] = ['high', 'balanced', 'performance'];
  const areas = [1000, 65536, 500000, 3000000];
  it('holds across a sweep', () => {
    for (let sigmaPx = 0; sigmaPx <= 80; sigmaPx += 0.3) {
      for (const q of qualities) {
        for (const area of areas) {
          const d = autoDownsample(sigmaPx, area, q);
          const snap = sigmaPx / d;
          if (sigmaPx >= 0.5) {
            expect(snap).toBeGreaterThanOrEqual(0.5 - EPS);
          }
          // and never below the 1px target unless sigmaPx < 1
          if (sigmaPx >= 1) {
            expect(snap).toBeGreaterThanOrEqual(1 - EPS);
          }
        }
      }
    }
  });
});

describe('property: crop mapping round-trips within half a snapshot pixel', () => {
  const targetBounds: Rect = { x: 0, y: 0, width: 1440, height: 3040 };
  const factors: Downsample[] = [1, 2, 4, 8];
  it('recovers the visible rect', () => {
    for (const d of factors) {
      for (const x of [0, 7, 100, 133, 901]) {
        for (const w of [50, 121, 300]) {
          const visible: Rect = { x, y: x + 3, width: w, height: w + 11 };
          const capture = expandCaptureRect(visible, targetBounds, 16);
          const snap = snapshotRectFor(capture, d);
          const crop = cropRectFor(visible, snap, d);
          const back = cropRectToViewPx(crop, snap, d);
          const half = d / 2;
          expect(Math.abs(back.x - visible.x)).toBeLessThanOrEqual(half + EPS);
          expect(Math.abs(back.y - visible.y)).toBeLessThanOrEqual(half + EPS);
          expect(Math.abs(back.width - visible.width)).toBeLessThanOrEqual(
            half + EPS
          );
          expect(Math.abs(back.height - visible.height)).toBeLessThanOrEqual(
            half + EPS
          );
        }
      }
    }
  });
});

describe('property: saturation identity at s=1, grayscale at s=0', () => {
  it('s=1 is identity on RGB', () => {
    const m = saturationMatrix(1);
    // diagonal 1, off-diagonal 0 within RGB block
    expect(m[0]).toBeCloseTo(1, 9);
    expect(m[6]).toBeCloseTo(1, 9);
    expect(m[12]).toBeCloseTo(1, 9);
    expect(m[1]).toBeCloseTo(0, 9);
    expect(m[2]).toBeCloseTo(0, 9);
  });
  it('s=0 rows equal luminance coefficients', () => {
    const m = saturationMatrix(0);
    for (const rowStart of [0, 5, 10]) {
      expect(m[rowStart + 0]).toBeCloseTo(0.2126, 9);
      expect(m[rowStart + 1]).toBeCloseTo(0.7152, 9);
      expect(m[rowStart + 2]).toBeCloseTo(0.0722, 9);
    }
  });
  it('alpha row untouched for all s', () => {
    for (const s of [0, 0.5, 1, 2, 5]) {
      const m = saturationMatrix(s);
      expect(m.slice(15)).toEqual([0, 0, 0, 1, 0]);
    }
  });
});
