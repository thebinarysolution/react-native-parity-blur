package com.parityblur

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Kotlin mirror of `src/pipeline/units.ts`, `src/pipeline/captureRect.ts`,
 * `src/pipeline/downsample.ts`, `src/pipeline/saturation.ts`, and the `sourceOver` half of
 * `src/pipeline/overlay.ts`. This is the executable form of docs/PIPELINE_SPEC.md §1-§4, §7 on
 * the Android side; `android/src/test/.../PipelineFixturesTest.kt` asserts every function here
 * against `test/pipeline-fixtures.json` within 1e-6.
 *
 * Pure Double/Int arithmetic, NO android.* imports -- testable as a plain JVM unit test.
 *
 * Deviation note (documented, not a pipeline behavior change): `overlay.ts`'s `parseColor` is
 * NOT mirrored here. Android's `overlayColor` native prop is a `ColorValue` already parsed into
 * an ARGB Int by React Native's own color parser before it reaches native code (see
 * ParityBlurViewNativeComponent.ts / ParityBlurViewManager), so there is no string-parsing step
 * on the native side to mirror. `sourceOver` IS mirrored below for the fixture suite even though
 * the runtime presentation path does not call it directly -- see ParityBlurView's overlay
 * comment for why a plain Canvas draw of the (already-parsed) overlay color is mathematically
 * equivalent source-over compositing on the opaque blurred destination.
 */
object PipelineMath {

  /** Axis-aligned rectangle, target-local device px unless documented otherwise. */
  data class Rect(val x: Double, val y: Double, val width: Double, val height: Double)

  /** Straight-alpha RGBA colour, channels normalised to [0, 1]. */
  data class RGBA(val r: Double, val g: Double, val b: Double, val a: Double)

  // ---------------------------------------------------------------- units.ts

  /** blurRadius (sigma in dp) -> sigma in device px. Non-finite/non-positive inputs clamp to 0. */
  fun sigmaPxFromDp(blurRadiusDp: Double, displayScale: Double): Double {
    if (!blurRadiusDp.isFinite() || blurRadiusDp <= 0) return 0.0
    if (!displayScale.isFinite() || displayScale <= 0) return 0.0
    return blurRadiusDp * displayScale
  }

  /** Device-px sigma -> snapshot-domain sigma given downsample factor D. */
  fun sigmaSnapshotFromPx(sigmaPx: Double, downsample: Int): Double {
    if (!sigmaPx.isFinite() || sigmaPx <= 0) return 0.0
    return sigmaPx / downsample
  }

  // ----------------------------------------------------------- captureRect.ts

  /** Gaussian support margin in device px (plan §7): ceil(K * sigmaPx). */
  fun supportMarginPx(sigmaPx: Double, k: Double = AndroidBlurCalibration.CAPTURE_SUPPORT_K): Double {
    if (!sigmaPx.isFinite() || sigmaPx <= 0) return 0.0
    return ceil(k * sigmaPx)
  }

  /** Intersection of two rects; zero-size rect if they do not overlap. */
  fun intersectRect(a: Rect, b: Rect): Rect {
    val x0 = max(a.x, b.x)
    val y0 = max(a.y, b.y)
    val x1 = min(a.x + a.width, b.x + b.width)
    val y1 = min(a.y + a.height, b.y + b.height)
    val width = max(0.0, x1 - x0)
    val height = max(0.0, y1 - y0)
    if (width == 0.0 || height == 0.0) return Rect(x0, y0, 0.0, 0.0)
    return Rect(x0, y0, width, height)
  }

  /**
   * Expand the visible blur rect by the Gaussian support margin and clamp to the target bounds
   * (plan §7). CLAMP handles the outer edge where the margin was cut off (plan §8).
   */
  fun expandCaptureRect(
    visibleRect: Rect,
    targetBounds: Rect,
    sigmaPx: Double,
    k: Double = AndroidBlurCalibration.CAPTURE_SUPPORT_K
  ): Rect {
    val margin = supportMarginPx(sigmaPx, k)
    val expanded = Rect(
      x = visibleRect.x - margin,
      y = visibleRect.y - margin,
      width = visibleRect.width + 2 * margin,
      height = visibleRect.height + 2 * margin
    )
    return intersectRect(expanded, targetBounds)
  }

  /** Area of a rect in device px^2 (downsample-selection helper). */
  fun rectArea(r: Rect): Double = r.width * r.height

  /**
   * Map a clamped device-px capture rect into integer snapshot pixels for downsample factor D.
   * LOCKED rounding rule (PIPELINE_SPEC §3.3): origin FLOORS, far edge CEILS (conservative
   * cover) -- every device pixel of the capture rect is guaranteed to land in the snapshot rect.
   */
  fun snapshotRectFor(captureRectPx: Rect, downsample: Int): Rect {
    val x = floor(captureRectPx.x / downsample)
    val y = floor(captureRectPx.y / downsample)
    val farX = ceil((captureRectPx.x + captureRectPx.width) / downsample)
    val farY = ceil((captureRectPx.y + captureRectPx.height) / downsample)
    return Rect(x, y, max(0.0, farX - x), max(0.0, farY - y))
  }

  /**
   * Fractional snapshot-px crop rect selecting the visible region out of the (larger) snapshot
   * rect after blur. The fractional origin remainder in [0,1) snapshot px is resolved by the
   * bilinear upsample -- do not round it away (PIPELINE_SPEC §3.4).
   *
   * The result is intersected with the snapshot's own extent: [expandCaptureRect] CLAMPS the
   * capture to the target bounds, but this crop is derived from the UNCLAMPED visible rect, so a
   * view lying partly outside the target (e.g. a fullscreen backdrop inside a sheet host that is
   * mid-`translateY`) would otherwise select pixels the snapshot never captured -- presenting the
   * captured band at a DISPLACED offset. Whenever the visible rect is contained in the target
   * bounds -- every case the fixtures and the calibration harness exercise -- expandCaptureRect
   * only ever grows beyond it before clamping, so the snapshot already covers visibleRect/D and
   * this intersection is the IDENTITY. It bites only in the partial-off-target case, where it
   * places the band correctly instead of displacing it.
   */
  fun cropRectFor(visibleRect: Rect, snapshotRect: Rect, downsample: Int): Rect {
    val raw = Rect(
      x = visibleRect.x / downsample - snapshotRect.x,
      y = visibleRect.y / downsample - snapshotRect.y,
      width = visibleRect.width / downsample,
      height = visibleRect.height / downsample
    )
    return intersectRect(raw, Rect(0.0, 0.0, snapshotRect.width, snapshotRect.height))
  }

  // ------------------------------------------------------------ downsample.ts

  private val DOWNSAMPLE_FACTORS = intArrayOf(8, 4, 2, 1)

  /** Largest allowed factor in {8,4,2,1} that is <= cap (never below 1). */
  private fun largestFactorAtMost(cap: Double): Int {
    for (factor in DOWNSAMPLE_FACTORS) {
      if (factor <= cap) return factor
    }
    return 1
  }

  /** Per-quality ceiling on the downsample factor (plan §13). */
  fun qualityMaxDownsample(quality: String): Int = when (quality) {
    "high" -> AndroidBlurCalibration.QUALITY_MAX_DOWNSAMPLE_HIGH
    "performance" -> AndroidBlurCalibration.QUALITY_MAX_DOWNSAMPLE_PERFORMANCE
    else -> AndroidBlurCalibration.QUALITY_MAX_DOWNSAMPLE_BALANCED
  }

  /**
   * Resolve the auto-selected downsample factor: the largest factor in {8,4,2,1} satisfying ALL
   * of the quality ceiling, the sigma floor, and the small-capture area ceiling
   * (PIPELINE_SPEC §4).
   */
  fun autoDownsample(sigmaPx: Double, captureAreaPx: Double, quality: String): Int {
    if (!sigmaPx.isFinite() || sigmaPx <= 0) return 1

    val maxByQuality = qualityMaxDownsample(quality)
    val maxBySigma = floor(sigmaPx / AndroidBlurCalibration.MIN_SIGMA_SNAPSHOT)
    val area = if (captureAreaPx.isFinite()) captureAreaPx else 0.0
    val maxByArea = if (area < AndroidBlurCalibration.SMALL_CAPTURE_AREA_PX) 2.0 else 8.0

    val cap = minOf(maxByQuality.toDouble(), maxBySigma, maxByArea)
    return largestFactorAtMost(cap)
  }

  /**
   * Resolve the public `downsample` prop (0 = 'auto' sentinel; see
   * ParityBlurViewNativeComponent.ts) to a concrete factor.
   */
  fun resolveDownsample(prop: Int, sigmaPx: Double, captureAreaPx: Double, quality: String): Int {
    if (prop == 0) return autoDownsample(sigmaPx, captureAreaPx, quality)
    return prop
  }

  // ------------------------------------------------------------- saturation.ts

  /**
   * Row-major 4x5 saturation matrix (20 numbers), matching Android's ColorMatrix layout and
   * mirroring `saturation.ts` exactly. `s = 1` -> identity; `s = 0` -> luminance grayscale.
   */
  fun saturationMatrix(
    s: Double,
    lr: Double = AndroidBlurCalibration.LUMA_R,
    lg: Double = AndroidBlurCalibration.LUMA_G,
    lb: Double = AndroidBlurCalibration.LUMA_B
  ): DoubleArray {
    val t = 1 - s
    return doubleArrayOf(
      t * lr + s, t * lg, t * lb, 0.0, 0.0,
      t * lr, t * lg + s, t * lb, 0.0, 0.0,
      t * lr, t * lg, t * lb + s, 0.0, 0.0,
      0.0, 0.0, 0.0, 1.0, 0.0
    )
  }

  /** Float32 copy of [saturationMatrix], the shape android.graphics.ColorMatrix expects. */
  fun saturationMatrixFloat(s: Double): FloatArray =
    FloatArray(20) { saturationMatrix(s)[it].toFloat() }

  // --------------------------------------------------------------- overlay.ts

  /**
   * Straight-alpha source-over composite: `src` over `dst`. Mirrors `overlay.ts` `sourceOver`
   * exactly. Exercised by the fixture suite; the runtime presentation path uses a direct Canvas
   * draw instead (see deviation note above).
   */
  fun sourceOver(src: RGBA, dst: RGBA): RGBA {
    val outA = src.a + dst.a * (1 - src.a)
    if (outA <= 0) return RGBA(0.0, 0.0, 0.0, 0.0)
    fun blend(sc: Double, dc: Double) = (sc * src.a + dc * dst.a * (1 - src.a)) / outA
    return RGBA(blend(src.r, dst.r), blend(src.g, dst.g), blend(src.b, dst.b), outA)
  }
}
