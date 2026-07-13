package com.parityblur

import com.facebook.react.bridge.Dynamic
import com.facebook.react.bridge.DynamicFromObject
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.LengthPercentage
import com.facebook.react.uimanager.LengthPercentageType
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.ViewProps
import com.facebook.react.uimanager.annotations.ReactPropGroup
import com.facebook.react.uimanager.style.BorderRadiusProp
import com.facebook.react.viewmanagers.ParityBlurViewManagerDelegate
import com.facebook.react.viewmanagers.ParityBlurViewManagerInterface

/**
 * Milestone 3 ViewManager for ParityBlurView (docs/MASTER_PLAN.md §36).
 *
 * Extends [ViewGroupManager] (not SimpleViewManager) so React Native children are hosted
 * normally above the blur result -- see plan §30. Codegen-declared props/commands (plan §28/§29)
 * are plumbed straight through to [ParityBlurView] via [ParityBlurViewManagerInterface].
 *
 * Border-radius handling (plan §31) is wired here directly rather than through codegen: common
 * View style props like `borderRadius` are NOT part of the codegen-generated
 * [ParityBlurViewManagerInterface] (that interface only covers props explicitly declared in
 * ParityBlurViewNativeComponent.ts). Android's Fabric ViewManagers apply such common style props
 * through the same legacy `@ReactProp`/`@ReactPropGroup` reflection path used by the plain
 * `<View>` -- see `BaseViewManager.setBorderRadius` (a no-op stub that just logs "doesn't support
 * property 'borderRadius'", which is exactly the warning Milestone 1 observed) and
 * `ReactViewManager.setBorderRadius` (the real, annotated override). We mirror
 * `ReactViewManager`'s approach: apply the radius to the view's background/border machinery via
 * [BackgroundStyleApplicator] (so any backgroundColor/border the view might have also respects
 * it) AND forward a resolved device-px value to [ParityBlurView.setCornerRadiusPx] so the blur
 * OUTPUT can be clipped with a matching rounded-rect path (plan §31: blur-output clipping and
 * child clipping are separate concerns -- children keep normal RN overflow semantics and are not
 * force-clipped here).
 *
 * Only the five physical corner properties from plan §31 are wired (uniform + four corners);
 * RTL logical corners (borderStartStartRadius etc.) and percentage radii are out of scope for
 * v1's blur-output clip (documented limitation) -- BackgroundStyleApplicator still receives the
 * raw value either way so the view's own background/border rendering is unaffected.
 */
@ReactModule(name = ParityBlurViewManager.NAME)
class ParityBlurViewManager :
  ViewGroupManager<ParityBlurView>(),
  ParityBlurViewManagerInterface<ParityBlurView> {

  /**
   * On Fabric, ALL prop updates route through the codegen [ViewManagerDelegate]; the
   * `@ReactPropGroup` reflection path below is consulted only on the legacy architecture.
   * Standard View style props not in our codegen spec (the border radii) fall through the
   * generated delegate to BaseViewManagerDelegate, which does not handle them and logs
   * "ParityBlurView doesn't support property 'borderRadius'" (observed on-device on RN 0.85).
   * This subclass intercepts the five physical corner props and routes them to the same
   * handler the legacy path uses, restoring plan §31 rounded clipping under Fabric.
   */
  private class BorderRadiusAwareDelegate(
    private val manager: ParityBlurViewManager,
  ) : ViewManagerDelegate<ParityBlurView> {
    // Composition, not inheritance: subclassing the generated Java delegate from Kotlin trips
    // an erased-JVM-signature clash on receiveCommand (platform declaration clash).
    private val inner =
      ParityBlurViewManagerDelegate<ParityBlurView, ParityBlurViewManager>(manager)

    override fun setProperty(view: ParityBlurView, propName: String, value: Any?) {
      val cornerIndex = when (propName) {
        ViewProps.BORDER_RADIUS -> 0
        ViewProps.BORDER_TOP_LEFT_RADIUS -> 1
        ViewProps.BORDER_TOP_RIGHT_RADIUS -> 2
        ViewProps.BORDER_BOTTOM_RIGHT_RADIUS -> 3
        ViewProps.BORDER_BOTTOM_LEFT_RADIUS -> 4
        else -> null
      }
      if (cornerIndex != null) {
        manager.setBorderRadius(view, cornerIndex, DynamicFromObject(value))
        return
      }
      @Suppress("DEPRECATION")
      inner.setProperty(view, propName, value)
    }

    override fun receiveCommand(view: ParityBlurView, commandName: String, args: ReadableArray) {
      inner.receiveCommand(view, commandName, args)
    }
  }

  private val mDelegate: ViewManagerDelegate<ParityBlurView> =
    BorderRadiusAwareDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<ParityBlurView> = mDelegate

  override fun getName(): String = NAME

  override fun createViewInstance(context: ThemedReactContext): ParityBlurView =
    ParityBlurView(context)

  override fun setBlurRadius(view: ParityBlurView?, value: Double) {
    view?.setBlurRadius(value)
  }

  override fun setMode(view: ParityBlurView?, value: String?) {
    view?.setMode(value)
  }

  override fun setOverlayColor(view: ParityBlurView?, value: Int?) {
    view?.setOverlayColor(value)
  }

  override fun setSaturation(view: ParityBlurView?, value: Double) {
    view?.setSaturation(value)
  }

  override fun setQuality(view: ParityBlurView?, value: String?) {
    view?.setQuality(value)
  }

  override fun setDownsample(view: ParityBlurView?, value: Int) {
    view?.setDownsample(value)
  }

  override fun setMaxFps(view: ParityBlurView?, value: Int) {
    view?.setMaxFps(value)
  }

  override fun setFallbackColor(view: ParityBlurView?, value: Int?) {
    view?.setFallbackColor(value)
  }

  override fun refresh(view: ParityBlurView?) {
    view?.refresh()
  }

  @ReactPropGroup(
    names = [
      ViewProps.BORDER_RADIUS,
      ViewProps.BORDER_TOP_LEFT_RADIUS,
      ViewProps.BORDER_TOP_RIGHT_RADIUS,
      ViewProps.BORDER_BOTTOM_RIGHT_RADIUS,
      ViewProps.BORDER_BOTTOM_LEFT_RADIUS,
    ]
  )
  fun setBorderRadius(view: ParityBlurView, index: Int, rawBorderRadius: Dynamic) {
    val lengthPercentage = LengthPercentage.setFromDynamic(rawBorderRadius)
    BackgroundStyleApplicator.setBorderRadius(view, BorderRadiusProp.values()[index], lengthPercentage)

    val px = if (lengthPercentage != null && lengthPercentage.type == LengthPercentageType.POINT) {
      PixelUtil.toPixelFromDIP(lengthPercentage.resolve(0f).toDouble())
    } else {
      null
    }
    view.setCornerRadiusPx(index, px)
  }

  companion object {
    const val NAME = "ParityBlurView"
  }
}
