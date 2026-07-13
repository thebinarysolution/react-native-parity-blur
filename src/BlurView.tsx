import * as React from 'react';

import NativeParityBlurView, {
  Commands as NativeCommands,
} from './ParityBlurViewNativeComponent';
import {
  DEFAULT_BLUR_RADIUS,
  DEFAULT_DOWNSAMPLE,
  DEFAULT_MAX_FPS,
  DEFAULT_MODE,
  DEFAULT_OVERLAY_COLOR,
  DEFAULT_QUALITY,
  DEFAULT_SATURATION,
  MAX_MAX_FPS,
  MIN_MAX_FPS,
} from './defaults';
import { BlurPresets } from './presets';
import type { BlurDownsample, BlurViewProps, BlurViewRef } from './types';

declare const __DEV__: boolean;

const LOG_TAG = '[react-native-parity-blur]';

function clampBlurRadius(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_BLUR_RADIUS;
  }
  return value < 0 ? 0 : value;
}

function clampSaturation(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SATURATION;
  }
  return value < 0 ? 0 : value;
}

function clampMaxFps(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_FPS;
  }
  return Math.min(MAX_MAX_FPS, Math.max(MIN_MAX_FPS, value));
}

/**
 * Normalizes the public `downsample` prop (`'auto' | 1 | 2 | 4 | 8`) into the
 * Int32 the native Fabric prop accepts, where `0` is a sentinel for `'auto'`.
 * See the deviation note in ParityBlurViewNativeComponent.ts for why this
 * isn't a string/numeric enum.
 */
function normalizeDownsample(
  value: BlurDownsample | undefined
): 0 | 1 | 2 | 4 | 8 {
  if (value === undefined || value === 'auto') {
    return 0;
  }
  if (value === 1 || value === 2 || value === 4 || value === 8) {
    return value;
  }
  if (__DEV__) {
    console.warn(
      `${LOG_TAG} Invalid "downsample" value: ${JSON.stringify(
        value
      )}. Expected 'auto' | 1 | 2 | 4 | 8. Falling back to '${DEFAULT_DOWNSAMPLE}'.`
    );
  }
  return 0;
}

type NativeInstance = React.ComponentRef<typeof NativeParityBlurView>;

/**
 * Public backdrop blur component (plan §28/§29/§30).
 *
 * Renders the native ParityBlurView host view backed by a real blur on both
 * platforms: Android API 31+ real-time `RenderEffect` Gaussian blur (older
 * Android renders `fallbackColor` instead — real CPU blur is intentionally
 * out of scope, plan §44), iOS `MPSImageGaussianBlur`. `refresh()` is fully
 * wired to a native coalesced recapture (plan §29). See
 * docs/PIPELINE_SPEC.md for the canonical pipeline both backends implement
 * and docs/CALIBRATION_REPORT.md for measured cross-platform parity.
 */
export const BlurView = React.forwardRef<BlurViewRef, BlurViewProps>(
  function BlurViewImpl(props, ref) {
    // `blurTarget` is intentionally not destructured: it is accepted on
    // BlurViewProps for public-API shape stability (plan §18) but not yet
    // wired to native capture logic. Deferred to v1.1 — see docs/LIMITATIONS.md.
    const {
      preset,
      blurRadius,
      mode = DEFAULT_MODE,
      overlayColor,
      saturation,
      quality = DEFAULT_QUALITY,
      downsample,
      maxFps,
      fallbackColor,
      children,
      style,
    } = props;

    // A preset (plan §11) is pure JS sugar for a base
    // { blurRadius, saturation, overlayColor } bundle — resolved here,
    // client-side, with no native awareness of presets at all. Any of
    // those three props passed explicitly above still wins per-prop.
    const presetProps = preset ? BlurPresets[preset] : undefined;
    const resolvedBlurRadius = blurRadius ?? presetProps?.blurRadius;
    const resolvedSaturation = saturation ?? presetProps?.saturation;
    const resolvedOverlayColor =
      overlayColor ?? presetProps?.overlayColor ?? DEFAULT_OVERLAY_COLOR;

    const nativeRef = React.useRef<NativeInstance>(null);

    React.useImperativeHandle(
      ref,
      (): BlurViewRef => ({
        refresh() {
          if (nativeRef.current) {
            NativeCommands.refresh(nativeRef.current);
          }
        },
      }),
      []
    );

    if (__DEV__) {
      if (preset !== undefined && !(preset in BlurPresets)) {
        console.warn(
          `${LOG_TAG} Unknown "preset" value: ${JSON.stringify(preset)}. Ignoring.`
        );
      }
      if (
        blurRadius !== undefined &&
        (typeof blurRadius !== 'number' ||
          !Number.isFinite(blurRadius) ||
          blurRadius < 0)
      ) {
        console.warn(
          `${LOG_TAG} "blurRadius" must be a finite number >= 0. Received: ${blurRadius}. Clamping to ${clampBlurRadius(
            blurRadius
          )}.`
        );
      }
      if (
        saturation !== undefined &&
        (typeof saturation !== 'number' ||
          !Number.isFinite(saturation) ||
          saturation < 0)
      ) {
        console.warn(
          `${LOG_TAG} "saturation" must be a finite number >= 0. Received: ${saturation}. Clamping to ${clampSaturation(
            saturation
          )}.`
        );
      }
      if (
        maxFps !== undefined &&
        (typeof maxFps !== 'number' ||
          !Number.isFinite(maxFps) ||
          maxFps < MIN_MAX_FPS ||
          maxFps > MAX_MAX_FPS)
      ) {
        console.warn(
          `${LOG_TAG} "maxFps" must be a finite number between ${MIN_MAX_FPS} and ${MAX_MAX_FPS}. Received: ${maxFps}. Clamping to ${clampMaxFps(
            maxFps
          )}.`
        );
      }
    }

    const safeBlurRadius = clampBlurRadius(resolvedBlurRadius);
    const safeSaturation = clampSaturation(resolvedSaturation);
    const safeMaxFps = clampMaxFps(maxFps);
    const safeDownsample = normalizeDownsample(downsample);

    return (
      <NativeParityBlurView
        ref={nativeRef}
        style={style}
        blurRadius={safeBlurRadius}
        mode={mode}
        overlayColor={resolvedOverlayColor}
        saturation={safeSaturation}
        quality={quality}
        downsample={safeDownsample}
        maxFps={safeMaxFps}
        fallbackColor={fallbackColor}
      >
        {children}
      </NativeParityBlurView>
    );
  }
);

export default BlurView;
