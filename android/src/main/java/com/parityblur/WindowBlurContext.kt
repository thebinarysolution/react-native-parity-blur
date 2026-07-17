package com.parityblur

import android.view.Choreographer
import android.view.View
import android.view.ViewTreeObserver
import java.util.Collections
import java.util.WeakHashMap

/**
 * Per-window active-view registry + capture scheduling (plan §4, §14.3, §14.4, §20, §21, §39).
 * One instance per native window (keyed by the window's root view in [BlurEngine]) --
 * NEVER one scheduler per [ParityBlurView] (plan §45.6).
 *
 * STATIC mode: capture requests (refresh(), layout/prop changes) coalesce to ONE capture per
 * view at the next frame boundary via [Choreographer.postFrameCallback] -- never synchronously
 * inside JS-command dispatch, never invalidating from preDraw (plan §45.8).
 *
 * LIVE mode (Milestone 6): ONE [ViewTreeObserver.OnPreDrawListener] per window, installed only
 * while at least one live view is registered and removed when the last leaves (plan §24: zero
 * scheduler work when no live blur is active). Each pre-draw tick:
 *   1. filters views by the visibility heuristic (plan §24),
 *   2. applies the per-view maxFps throttle (plan §21: respect elapsed time),
 *   3. recaptures INSIDE the in-flight frame -- the re-recorded RenderNode propagates its own
 *      damage, so no invalidate() is issued from preDraw (M0-proven; plan §45).
 * Captures here are synchronous software captures (see [ParityBlurView.performLiveCapture]),
 * so backpressure (plan §22) is inherent: at most one capture per view per frame, and a slow
 * frame simply delays the next tick -- no queue can form.
 */
class WindowBlurContext(private val rootView: View) {

  /** All currently-attached ParityBlurView instances in this window (weak, for bookkeeping). */
  private val activeViews: MutableSet<ParityBlurView> =
    Collections.newSetFromMap(WeakHashMap())

  private val pendingCaptures = LinkedHashSet<ParityBlurView>()
  private var frameCallbackScheduled = false

  private val frameCallback = Choreographer.FrameCallback {
    frameCallbackScheduled = false
    // Snapshot-and-clear before iterating: a capture triggered from within this callback
    // schedules a NEW frame instead of mutating the set being iterated right now.
    val batch = pendingCaptures.toList()
    pendingCaptures.clear()
    for (view in batch) {
      if (view.isAttachedToWindow) {
        view.performScheduledCapture()
      }
    }
  }

  // ------------------------------------------------------------------- live (Milestone 6)

  private val liveViews: MutableSet<ParityBlurView> =
    Collections.newSetFromMap(WeakHashMap())

  /**
   * Static views whose window position is watched each frame (plan §18). Separate from
   * [liveViews]: these do NOT recapture per frame, they only re-request a capture when their
   * position in the window actually changes.
   */
  private val geometryWatched: MutableSet<ParityBlurView> =
    Collections.newSetFromMap(WeakHashMap())

  private var preDrawInstalled = false

  private val preDrawListener = ViewTreeObserver.OnPreDrawListener {
    val now = System.nanoTime()
    for (view in liveViews) {
      if (view.isLiveEligible(now)) {
        view.performLiveCapture(now)
      }
    }
    // Geometry watch (plan §18): the only trigger that sees an ancestor TRANSFORM -- onSizeChanged
    // and onLayout both miss it, so without this a static backdrop inside a transform-animated
    // sheet host freezes whatever partial band it captured mid-animation. Each view costs one
    // getLocationInWindow + two int compares; a changed position only REQUESTS a capture, which the
    // Choreographer path then coalesces as usual.
    for (view in geometryWatched) {
      view.checkWindowGeometry()
    }
    true
  }

  /**
   * Install/uninstall the shared pre-draw listener to match demand (plan §24): it runs only while
   * this window actually has live views or watched static views. NOTE: plan §24's "zero scheduler
   * work when no live blur is active" now reads "no live blur AND no attached static blur" -- a
   * static view must be watched to notice an ancestor transform. The per-frame cost of a watched
   * static view is a position compare, not a capture.
   */
  private fun syncPreDrawListener() {
    val wanted = liveViews.isNotEmpty() || geometryWatched.isNotEmpty()
    if (wanted && !preDrawInstalled) {
      val vto = rootView.viewTreeObserver
      if (vto.isAlive) {
        vto.addOnPreDrawListener(preDrawListener)
        preDrawInstalled = true
        ParityBlurDebug.log { "scheduler-install window=${System.identityHashCode(rootView)}" }
      }
    } else if (!wanted && preDrawInstalled) {
      val vto = rootView.viewTreeObserver
      if (vto.isAlive) vto.removeOnPreDrawListener(preDrawListener)
      preDrawInstalled = false
      ParityBlurDebug.log { "scheduler-uninstall window=${System.identityHashCode(rootView)}" }
    }
  }

  fun registerGeometryWatch(view: ParityBlurView) {
    geometryWatched.add(view)
    syncPreDrawListener()
  }

  fun unregisterGeometryWatch(view: ParityBlurView) {
    geometryWatched.remove(view)
    syncPreDrawListener()
  }

  fun register(view: ParityBlurView) {
    activeViews.add(view)
  }

  fun unregister(view: ParityBlurView) {
    activeViews.remove(view)
    pendingCaptures.remove(view)
    unregisterLive(view)
    unregisterGeometryWatch(view)
  }

  fun registerLive(view: ParityBlurView) {
    liveViews.add(view)
    syncPreDrawListener()
  }

  fun unregisterLive(view: ParityBlurView) {
    liveViews.remove(view)
    syncPreDrawListener()
  }

  /**
   * Coalesce a capture request for [view] to the next valid frame boundary. Repeated calls
   * before the frame fires collapse into one capture (plan §14.4/§20).
   */
  fun scheduleCapture(view: ParityBlurView) {
    pendingCaptures.add(view)
    if (!frameCallbackScheduled) {
      frameCallbackScheduled = true
      Choreographer.getInstance().postFrameCallback(frameCallback)
    }
  }

  fun cancelScheduledCapture(view: ParityBlurView) {
    pendingCaptures.remove(view)
  }

  fun isEmpty(): Boolean = activeViews.isEmpty()
}
