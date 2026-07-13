package com.parityblur

/**
 * Locked calibration constants (docs/PIPELINE_SPEC.md §1-2, plan §5.2, §10, §12-13).
 *
 * Exact Kotlin mirror of `src/pipeline/constants.ts` + `src/pipeline/androidCalibration.ts`.
 * This is the SINGLE home for the HWUI sigma<->radius relation and the other locked pipeline
 * constants on the Android side (plan §45.10: do not hard-code Android conversion logic
 * throughout the codebase). `android/src/test/.../PipelineFixturesTest.kt` asserts these
 * functions match `test/pipeline-fixtures.json` within 1e-6.
 *
 * All math here is pure Double arithmetic with NO android.* imports, so it is testable as a
 * plain JVM unit test without Robolectric.
 */
object AndroidBlurCalibration {

  /**
   * HWUI RenderEffect Gaussian relation, verified exact on a Pixel 6a (API 36) in M0:
   * `sigma = HWUI_SIGMA_SLOPE * radiusPlatform + HWUI_SIGMA_INTERCEPT`.
   */
  const val HWUI_SIGMA_SLOPE: Double = 0.57735
  const val HWUI_SIGMA_INTERCEPT: Double = 0.5

  /**
   * Below this snapshot-domain sigma the inverse radius is non-positive, so we emit a no-blur
   * passthrough instead of feeding a bogus radius to RenderEffect.createBlurEffect. Equal to
   * HWUI_SIGMA_INTERCEPT by construction (radius 0 <=> sigma 0.5).
   */
  const val ANDROID_MIN_BLUR_SIGMA: Double = HWUI_SIGMA_INTERCEPT

  /** Gaussian support multiplier for capture expansion (plan §7). */
  const val CAPTURE_SUPPORT_K: Double = 3.0

  /** Auto-downsample: keep sigmaSnapshot = sigmaPx / D >= this many snapshot px. */
  const val MIN_SIGMA_SNAPSHOT: Double = 1.0

  /**
   * Auto-downsample: captures with area (device px^2) below this are capped at 2x.
   * 256 * 256 device px.
   */
  const val SMALL_CAPTURE_AREA_PX: Double = 256.0 * 256.0

  /** Auto-downsample: per-quality ceiling on the downsample factor (plan §13). */
  const val QUALITY_MAX_DOWNSAMPLE_HIGH: Int = 2
  const val QUALITY_MAX_DOWNSAMPLE_BALANCED: Int = 4
  const val QUALITY_MAX_DOWNSAMPLE_PERFORMANCE: Int = 8

  /** Rec. 709 luminance coefficients (plan §10), used by the saturation matrix. */
  const val LUMA_R: Double = 0.2126
  const val LUMA_G: Double = 0.7152
  const val LUMA_B: Double = 0.0722

  /**
   * Result of [radiusForSigma]. [radiusPlatform] is always >= 0; it is 0 when [noBlur] is true.
   * `radiusPlatform` is intentionally Double (not Float) so the pure-math mirror can be asserted
   * against the fixture table within 1e-6 -- callers cast to Float only at the RenderEffect call
   * site.
   */
  data class BlurParam(val noBlur: Boolean, val radiusPlatform: Double)

  /**
   * Forward relation, exposed for tests/verification: the sigma HWUI produces for a given
   * platform radius.
   */
  fun sigmaForRadius(radiusPlatform: Double): Double =
    HWUI_SIGMA_SLOPE * radiusPlatform + HWUI_SIGMA_INTERCEPT

  /**
   * Inverse relation: the platform radius required to achieve a target snapshot-domain sigma.
   * Below the intercept this returns a no-blur result. Monotonically non-decreasing in
   * sigmaSnapshot. Exact mirror of androidCalibration.ts `radiusForSigma`.
   */
  fun radiusForSigma(sigmaSnapshot: Double): BlurParam {
    if (!sigmaSnapshot.isFinite() || sigmaSnapshot <= ANDROID_MIN_BLUR_SIGMA) {
      return BlurParam(noBlur = true, radiusPlatform = 0.0)
    }
    return BlurParam(
      noBlur = false,
      radiusPlatform = (sigmaSnapshot - HWUI_SIGMA_INTERCEPT) / HWUI_SIGMA_SLOPE
    )
  }
}
