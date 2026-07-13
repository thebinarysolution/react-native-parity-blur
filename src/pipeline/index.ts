/**
 * Canonical pipeline reference implementation — INTERNAL barrel.
 *
 * This module is the executable form of docs/PIPELINE_SPEC.md: pure TypeScript,
 * no react-native imports, no side effects. Native backends (Kotlin / Swift)
 * must reproduce these exact rules.
 *
 * IMPORTANT: this barrel is intentionally NOT re-exported from src/index.ts.
 * It is a spec/testing artifact, not part of the package's public API.
 */

export * from './types';
export * from './constants';
export * from './units';
export * from './androidCalibration';
export * from './downsample';
export * from './captureRect';
export * from './saturation';
export * from './color';
export * from './overlay';
