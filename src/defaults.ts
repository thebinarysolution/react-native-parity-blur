import type { BlurDownsample, BlurMode, BlurQuality } from './types';

export const DEFAULT_BLUR_RADIUS = 0;
export const DEFAULT_MODE: BlurMode = 'static';
export const DEFAULT_OVERLAY_COLOR = 'transparent';
export const DEFAULT_SATURATION = 1;
export const DEFAULT_QUALITY: BlurQuality = 'balanced';
export const DEFAULT_DOWNSAMPLE: BlurDownsample = 'auto';
export const DEFAULT_MAX_FPS = 30;

export const MIN_MAX_FPS = 1;
export const MAX_MAX_FPS = 120;

export const ALLOWED_DOWNSAMPLE_VALUES: ReadonlyArray<BlurDownsample> = [
  'auto',
  1,
  2,
  4,
  8,
];
