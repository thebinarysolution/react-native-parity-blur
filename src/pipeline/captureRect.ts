/**
 * Capture-rect math (plan §7, §12).
 *
 * INTERNAL MODULE. All rectangles here are in TARGET-LOCAL DEVICE PIXELS unless
 * a field/return is explicitly documented as snapshot pixels.
 *
 * Pipeline of this module:
 *   1. supportMarginPx  — Gaussian support margin = ceil(K * sigmaPx)
 *   2. expandCaptureRect — expand visible rect by margin, clamp to target bounds
 *   3. snapshotRectFor   — map the clamped device-px rect into integer snapshot
 *                          pixels (floor origin, ceil far edge = conservative
 *                          cover)
 *   4. cropRectFor       — the sub-region of the snapshot that maps back to the
 *                          visible rect (fractional, snapshot px)
 *   5. cropRectToViewPx  — inverse mapping used to prove round-tripping
 *
 * Rounding rule (LOCKED): in the snapshot domain the origin FLOORS and the far
 * edge CEILS, so `size = ceil(farEdge/D) - floor(origin/D)`. This is the
 * conservative reading of "floor for origin, ceil for size": it guarantees
 * every device pixel of the clamped capture rect is covered by the snapshot
 * rect, at the cost of at most one extra snapshot pixel per side. A naive
 * `floor(origin), ceil(width)` would fail to cover the far edge and is NOT used.
 */

import { CAPTURE_SUPPORT_K } from './constants';
import type { Downsample, Rect } from './types';

/** Gaussian support margin in device px (plan §7): ceil(K * sigmaPx). */
export function supportMarginPx(
  sigmaPx: number,
  k: number = CAPTURE_SUPPORT_K
): number {
  if (!Number.isFinite(sigmaPx) || sigmaPx <= 0) return 0;
  return Math.ceil(k * sigmaPx);
}

/** Intersection of two rects; empty (zero-size) rect if they do not overlap. */
export function intersectRect(a: Rect, b: Rect): Rect {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  if (width === 0 || height === 0) {
    return { x: x0, y: y0, width: 0, height: 0 };
  }
  return { x: x0, y: y0, width, height };
}

/**
 * Expand the visible blur rect by the Gaussian support margin and clamp to the
 * target bounds. Returns a float device-px rect (plan §7). The margin only
 * covers content that exists inside the target; CLAMP handles the outer edge
 * where the margin was cut off (plan §8).
 */
export function expandCaptureRect(
  visibleRect: Rect,
  targetBounds: Rect,
  sigmaPx: number,
  k: number = CAPTURE_SUPPORT_K
): Rect {
  const margin = supportMarginPx(sigmaPx, k);
  const expanded: Rect = {
    x: visibleRect.x - margin,
    y: visibleRect.y - margin,
    width: visibleRect.width + 2 * margin,
    height: visibleRect.height + 2 * margin,
  };
  return intersectRect(expanded, targetBounds);
}

/** Area of a rect in device px^2 (helper for downsample selection). */
export function rectArea(r: Rect): number {
  return r.width * r.height;
}

/**
 * Map a clamped device-px capture rect into integer snapshot pixels for
 * downsample factor D. Floor the origin, ceil the far edge (conservative
 * cover). The returned rect is in SNAPSHOT PIXELS (indices), so its device-px
 * footprint is `snapshotRect * D`.
 */
export function snapshotRectFor(
  captureRectPx: Rect,
  downsample: Downsample
): Rect {
  const x = Math.floor(captureRectPx.x / downsample);
  const y = Math.floor(captureRectPx.y / downsample);
  const farX = Math.ceil((captureRectPx.x + captureRectPx.width) / downsample);
  const farY = Math.ceil((captureRectPx.y + captureRectPx.height) / downsample);
  return { x, y, width: Math.max(0, farX - x), height: Math.max(0, farY - y) };
}

/**
 * The fractional crop rect, in SNAPSHOT PIXELS, that selects the visible region
 * out of the (larger) snapshot rect after blur. Because the snapshot origin was
 * floored, the crop origin carries a fractional remainder in [0, 1) snapshot px
 * which the upsample step resolves with bilinear sampling (plan §12).
 *
 *   cropX = visibleRect.x / D  -  snapshotRect.x
 *   cropW = visibleRect.width / D
 */
export function cropRectFor(
  visibleRect: Rect,
  snapshotRect: Rect,
  downsample: Downsample
): Rect {
  return {
    x: visibleRect.x / downsample - snapshotRect.x,
    y: visibleRect.y / downsample - snapshotRect.y,
    width: visibleRect.width / downsample,
    height: visibleRect.height / downsample,
  };
}

/**
 * Inverse of {@link cropRectFor}: map a snapshot-px crop rect back to
 * target-local device px. Used to verify round-tripping (should recover the
 * original visible rect within half a snapshot pixel = D/2 device px).
 */
export function cropRectToViewPx(
  cropRect: Rect,
  snapshotRect: Rect,
  downsample: Downsample
): Rect {
  return {
    x: (snapshotRect.x + cropRect.x) * downsample,
    y: (snapshotRect.y + cropRect.y) * downsample,
    width: cropRect.width * downsample,
    height: cropRect.height * downsample,
  };
}

export interface CapturePlan {
  /** Input visible blur rect (target-local device px). */
  visibleRect: Rect;
  /** Gaussian support margin (device px). */
  marginPx: number;
  /** Expanded + clamped capture rect (target-local device px, float). */
  captureRectPx: Rect;
  /** Capture area used for downsample selection (device px^2). */
  captureAreaPx: number;
  /** Selected downsample factor. */
  downsample: Downsample;
  /** Integer snapshot-pixel rect to allocate/blur. */
  snapshotRect: Rect;
  /** Fractional snapshot-px crop rect selecting the visible region. */
  cropRect: Rect;
}

/**
 * Assemble the full capture plan for a given visible rect, target bounds,
 * sigmaPx and pre-resolved downsample factor. Downsample resolution lives in
 * downsample.ts and takes `captureAreaPx` from this same computation, so the
 * caller sequences: expand -> area -> resolveDownsample -> buildCapturePlan.
 */
export function buildCapturePlan(
  visibleRect: Rect,
  targetBounds: Rect,
  sigmaPx: number,
  downsample: Downsample,
  k: number = CAPTURE_SUPPORT_K
): CapturePlan {
  const marginPx = supportMarginPx(sigmaPx, k);
  const captureRectPx = expandCaptureRect(
    visibleRect,
    targetBounds,
    sigmaPx,
    k
  );
  const snapshotRect = snapshotRectFor(captureRectPx, downsample);
  const cropRect = cropRectFor(visibleRect, snapshotRect, downsample);
  return {
    visibleRect,
    marginPx,
    captureRectPx,
    captureAreaPx: rectArea(captureRectPx),
    downsample,
    snapshotRect,
    cropRect,
  };
}
