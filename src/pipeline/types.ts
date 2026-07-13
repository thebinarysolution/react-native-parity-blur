/**
 * Shared value types for the canonical pipeline reference implementation.
 *
 * INTERNAL MODULE. Nothing here is re-exported from src/index.ts. These types
 * describe the language-neutral contract that both native backends implement;
 * they are the executable form of docs/PIPELINE_SPEC.md.
 */

import type { BlurDownsample, BlurQuality } from '../types';

/** Integer downsample factor actually used by the pipeline (never 'auto'). */
export type Downsample = 1 | 2 | 4 | 8;

/** The four concrete downsample factors, largest first (selection order). */
export const DOWNSAMPLE_FACTORS: readonly Downsample[] = [8, 4, 2, 1];

/**
 * Axis-aligned rectangle. Units are documented per-field by the producing
 * function (device px in target-local space, or snapshot px). Origin is the
 * top-left corner; width/height grow right/down.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Straight-alpha RGBA colour, all channels normalised to [0, 1]. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type { BlurDownsample, BlurQuality };
