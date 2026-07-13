package com.parityblur

import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.util.Log
import android.view.View
import java.util.WeakHashMap

/**
 * Process-wide blur engine (plan §4, §14.5, §26, §27).
 *
 * Created LAZILY on first eligible capture -- NEVER at class load / package init / module
 * import. API<31 and no-blur-only [ParityBlurView] instances must never call [get] (plan §27,
 * §45.1); enforcing that is the caller's responsibility (see ParityBlurView.isRealBlurSupported).
 *
 * Holds:
 *  - trim-memory registration (ComponentCallbacks2) that clears the bitmap pool under memory
 *    pressure (plan §26).
 *  - a small bitmap pool keyed by (width, height), capped in retained bytes (plan §14.5: a pool
 *    is justified here because the software capture path allocates a bitmap per capture --
 *    M0-REPORT "Plan amendments" #2).
 *  - a weak per-window registry of [WindowBlurContext] (plan §4), keyed by each window's root
 *    view so contexts disappear with their window and are never a source of leaks.
 */
class BlurEngine private constructor() : ComponentCallbacks2 {

  private val bitmapPool = HashMap<Long, MutableList<Bitmap>>()
  private var pooledBytes = 0L

  private val windowContexts = WeakHashMap<View, WindowBlurContext>()

  @Synchronized
  fun windowContextFor(rootView: View): WindowBlurContext {
    return windowContexts.getOrPut(rootView) { WindowBlurContext(rootView) }
  }

  @Synchronized
  fun releaseWindowContext(rootView: View) {
    windowContexts.remove(rootView)
  }

  /** Acquire a pooled ARGB_8888 bitmap sized exactly (width x height), or allocate one. */
  @Synchronized
  fun acquireBitmap(width: Int, height: Int): Bitmap {
    val key = poolKey(width, height)
    val bucket = bitmapPool[key]
    val reused = if (!bucket.isNullOrEmpty()) bucket.removeAt(bucket.size - 1) else null
    if (reused != null && !reused.isRecycled) {
      pooledBytes -= reused.allocationByteCount.toLong()
      reused.eraseColor(0)
      return reused
    }
    return Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
  }

  /** Return a bitmap to the pool for reuse, capping total retained bytes (plan §14.5). */
  @Synchronized
  fun releaseBitmap(bitmap: Bitmap) {
    if (bitmap.isRecycled) return
    val size = bitmap.allocationByteCount.toLong()
    if (pooledBytes + size > MAX_POOL_BYTES) {
      // Do not grow unbounded and do not evict-and-thrash; just drop this one (plan §45.13:
      // do not pool large resources without measured need -- keep the cap conservative).
      return
    }
    val key = poolKey(bitmap.width, bitmap.height)
    val bucket = bitmapPool.getOrPut(key) { mutableListOf() }
    bucket.add(bitmap)
    pooledBytes += size
  }

  @Synchronized
  private fun clearPool() {
    for (bucket in bitmapPool.values) {
      for (bmp in bucket) if (!bmp.isRecycled) bmp.recycle()
      bucket.clear()
    }
    bitmapPool.clear()
    pooledBytes = 0L
  }

  // ------------------------------------------------------- ComponentCallbacks2 (plan §26)

  @Suppress("DEPRECATION")
  override fun onTrimMemory(level: Int) {
    if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW ||
      level == ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN
    ) {
      Log.d(TAG, "onTrimMemory($level): clearing bitmap pool ($pooledBytes bytes)")
      clearPool()
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) = Unit

  @Suppress("OVERRIDE_DEPRECATION")
  override fun onLowMemory() {
    clearPool()
  }

  companion object {
    private const val TAG = "ParityBlur.Engine"

    /** Conservative retained-bitmap cap; snapshots are already downsampled (plan §14.5). */
    private const val MAX_POOL_BYTES = 16L * 1024 * 1024 // 16 MiB

    @Volatile
    private var instance: BlurEngine? = null

    /**
     * Lazily create (or return) the process-wide engine. MUST be called only from the first
     * eligible real-blur capture path -- never from class init, static fields, or fallback-only
     * view code (plan §27, §45.1).
     */
    fun get(context: Context): BlurEngine {
      instance?.let { return it }
      synchronized(this) {
        instance?.let { return it }
        val created = BlurEngine()
        context.applicationContext.registerComponentCallbacks(created)
        instance = created
        ParityBlurDebug.log { "engine-init" }
        return created
      }
    }

    private fun poolKey(width: Int, height: Int): Long =
      (width.toLong() shl 32) or (height.toLong() and 0xffffffffL)
  }
}
