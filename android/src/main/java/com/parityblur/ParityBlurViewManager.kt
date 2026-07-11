package com.parityblur

import android.graphics.Color
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.viewmanagers.ParityBlurViewManagerInterface
import com.facebook.react.viewmanagers.ParityBlurViewManagerDelegate

@ReactModule(name = ParityBlurViewManager.NAME)
class ParityBlurViewManager : SimpleViewManager<ParityBlurView>(),
  ParityBlurViewManagerInterface<ParityBlurView> {
  private val mDelegate: ViewManagerDelegate<ParityBlurView>

  init {
    mDelegate = ParityBlurViewManagerDelegate(this)
  }

  override fun getDelegate(): ViewManagerDelegate<ParityBlurView>? {
    return mDelegate
  }

  override fun getName(): String {
    return NAME
  }

  public override fun createViewInstance(context: ThemedReactContext): ParityBlurView {
    return ParityBlurView(context)
  }

  @ReactProp(name = "color")
  override fun setColor(view: ParityBlurView?, color: Int?) {
    view?.setBackgroundColor(color ?: Color.TRANSPARENT)
  }

  companion object {
    const val NAME = "ParityBlurView"
  }
}
