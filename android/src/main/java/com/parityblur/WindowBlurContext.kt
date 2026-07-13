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
  private var preDrawInstalled = false

  private val preDrawListener = ViewTreeObserver.OnPreDrawListener {
    val now = System.nanoTime()
    for (view in liveViews) {
      if (view.isLiveEligible(now)) {
        view.performLiveCapture(now)
      }
    }
    true
  }

  fun register(view: ParityBlurView) {
    activeViews.add(view)
  }

  fun unregister(view: ParityBlurView) {
    activeViews.remove(view)
    pendingCaptures.remove(view)
    unregisterLive(view)
  }

  fun registerLive(view: ParityBlurView) {
    liveViews.add(view)
    if (!preDrawInstalled) {
      val vto = rootView.viewTreeObserver
      if (vto.isAlive) {
        vto.addOnPreDrawListener(preDrawListener)
        preDrawInstalled = true
        ParityBlurDebug.log { "scheduler-install window=${System.identityHashCode(rootView)}" }
      }
    }
  }

  fun unregisterLive(view: ParityBlurView) {
    liveViews.remove(view)
    if (liveViews.isEmpty() && preDrawInstalled) {
      val vto = rootView.viewTreeObserver
      if (vto.isAlive) vto.removeOnPreDrawListener(preDrawListener)
      preDrawInstalled = false
      ParityBlurDebug.log { "scheduler-uninstall window=${System.identityHashCode(rootView)}" }
    }
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
