package com.parityblur

import android.app.Activity
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.ViewGroup
import android.view.Window
import com.facebook.react.uimanager.ThemedReactContext
import kotlin.math.roundToInt

/**
 * GPU-composited first-capture provider (M5 finding, amending plan §14.1 a second time).
 *
 * The software-canvas provider cannot rasterize HARDWARE bitmaps (Fresco decodes RN `Image`s to
 * Config.HARDWARE on modern devices; drawing one into a software Canvas is skipped), so any
 * image-backed backdrop went missing from captures — observed on-device as black blur strips
 * over an Image fixture. [PixelCopy] reads the SurfaceFlinger-composited window content instead:
 * hardware bitmaps, TextureViews, everything on screen — and scales into a smaller destination
 * bitmap, giving us the downsample step for free.
 *
 * Constraint: PixelCopy sees the FULL composited frame, including this blur view's own output —
 * so it is only safe while the view has never presented anything (first capture; the
 * presentation node is empty and children have not yet been committed above an empty region...
 * children ARE composited, so the capture may include children committed in the same region).
 * Callers therefore use it ONLY for the first capture after mount, scheduled before the view's
 * first presentation reaches the screen; RE-captures keep the software provider (its
 * hardware-bitmap gap on recapture is a documented v1 limitation, plan §43).
 *
 * Async by nature: results arrive on the main handler; callers must re-validate generation and
 * attachment before presenting (plan §23 — this is exactly what generation tokens exist for).
 */
object PixelCopySnapshotProvider {

  fun capture(
    view: ParityBlurView,
    target: ViewGroup,
    blurRadiusDp: Double,
    downsampleProp: Int,
    quality: String,
    engine: BlurEngine,
    onResult: (SoftwareSnapshotProvider.Result?) -> Unit
  ) {
    val window = windowFor(view)
    if (window == null) {
      onResult(null)
      return
    }
    val plan = SoftwareSnapshotProvider.computePlan(view, target, blurRadiusDp, downsampleProp, quality)
    if (plan == null) {
      onResult(null)
      return
    }

    val d = plan.downsample
    // Snapshot rect in WINDOW device px (snapshot px * D, offset by the target's position).
    val decor = window.decorView
    val srcRect = Rect(
      (plan.targetLocX + plan.snapshotRect.x * d).roundToInt(),
      (plan.targetLocY + plan.snapshotRect.y * d).roundToInt(),
      (plan.targetLocX + (plan.snapshotRect.x + plan.snapshotRect.width) * d).roundToInt(),
      (plan.targetLocY + (plan.snapshotRect.y + plan.snapshotRect.height) * d).roundToInt()
    )
    // The ceil'd far edge can overhang the window by < D px; clamp (edge error <= 1 snapshot px
    // inside the gaussian support margin -- invisible, and CLAMP tiling covers the boundary).
    if (!srcRect.intersect(Rect(0, 0, decor.width, decor.height))) {
      onResult(null)
      return
    }

    val bitmap = engine.acquireBitmap(plan.snapW, plan.snapH)
    try {
      PixelCopy.request(
        window,
        srcRect,
        bitmap,
        { copyResult ->
          if (copyResult == PixelCopy.SUCCESS) {
            onResult(
              SoftwareSnapshotProvider.Result(
                bitmap = bitmap,
                cropRect = plan.cropRect,
                downsample = plan.downsample,
                noBlur = plan.noBlur,
                radiusPlatform = plan.radiusPlatform
              )
            )
          } else {
            engine.releaseBitmap(bitmap)
            onResult(null)
          }
        },
        Handler(Looper.getMainLooper())
      )
    } catch (t: Throwable) {
      // e.g. IllegalArgumentException("Window doesn't have a backing surface") during teardown.
      engine.releaseBitmap(bitmap)
      onResult(null)
    }
  }

  private fun windowFor(view: ParityBlurView): Window? {
    val ctx = view.context
    val activity = (ctx as? ThemedReactContext)?.currentActivity ?: ctx as? Activity
    return activity?.window
  }
}
