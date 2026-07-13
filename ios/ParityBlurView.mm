#import "ParityBlurView.h"

#import <React/RCTConversions.h>

#import <react/renderer/components/ParityBlurViewSpec/ComponentDescriptors.h>
#import <react/renderer/components/ParityBlurViewSpec/Props.h>
#import <react/renderer/components/ParityBlurViewSpec/RCTComponentViewHelpers.h>

#import "RCTFabricComponentsPlugins.h"

#if __has_include("ParityBlur-Swift.h")
#import "ParityBlur-Swift.h"
#else
#import <ParityBlur/ParityBlur-Swift.h>
#endif

using namespace facebook::react;

/**
 * Milestone 4: Fabric shell for the iOS static blur backend.
 *
 * All blur work lives in the Swift core (ParityBlurCoreView.swift): lazy BlurEngine,
 * per-window coalesced capture, LayerRender snapshot provider with registry exclusion,
 * MPS gaussian + compute post pass, CAMetalLayer presentation (plan §15, §37;
 * docs/PIPELINE_SPEC.md). This file only:
 *   - hosts the core view as contentView (children mount above it, plan §30),
 *   - maps Fabric props onto the core's typed properties,
 *   - resolves the style border radii for the blur-output clip (plan §31),
 *   - forwards the refresh() command (plan §29).
 */
@interface ParityBlurView () <RCTParityBlurViewViewProtocol>
@end

/** Resolve one cascaded corner (Point units only; percent is unsupported for the blur clip). */
static CGFloat PBResolveRadius(const std::optional<ValueUnit> &corner, CGFloat fallback)
{
  if (corner.has_value() && corner->unit == UnitType::Point) {
    return (CGFloat)corner->value;
  }
  return fallback;
}

@implementation ParityBlurView {
  ParityBlurCoreView *_core;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ParityBlurViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const ParityBlurViewProps>();
    _props = defaultProps;

    _core = [[ParityBlurCoreView alloc] initWithFrame:CGRectZero];
    self.contentView = _core;
  }

  return self;
}

// RCTViewComponentView's base -mountChildComponentView:index: inserts every child as a direct
// subview of `self` at its Fabric child index. The core view occupies subview index 0
// (contentView), so children shift up one slot to stack above the blur output (plan §30).

- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView
                          index:(NSInteger)index
{
  [self insertSubview:childComponentView atIndex:index + 1];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView
                             index:(NSInteger)index
{
  [childComponentView removeFromSuperview];
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &oldViewProps = *std::static_pointer_cast<ParityBlurViewProps const>(_props);
  const auto &newViewProps = *std::static_pointer_cast<ParityBlurViewProps const>(props);

  if (oldViewProps.blurRadius != newViewProps.blurRadius) {
    _core.blurRadius = newViewProps.blurRadius;
  }
  if (oldViewProps.mode != newViewProps.mode) {
    _core.mode = [NSString stringWithUTF8String:toString(newViewProps.mode).c_str()];
  }
  if (oldViewProps.overlayColor != newViewProps.overlayColor) {
    _core.overlayColor = RCTUIColorFromSharedColor(newViewProps.overlayColor);
  }
  if (oldViewProps.saturation != newViewProps.saturation) {
    _core.saturation = newViewProps.saturation;
  }
  if (oldViewProps.quality != newViewProps.quality) {
    _core.quality = [NSString stringWithUTF8String:toString(newViewProps.quality).c_str()];
  }
  if (oldViewProps.downsample != newViewProps.downsample) {
    _core.downsample = newViewProps.downsample;
  }
  if (oldViewProps.maxFps != newViewProps.maxFps) {
    _core.maxFps = newViewProps.maxFps;
  }
  if (oldViewProps.fallbackColor != newViewProps.fallbackColor) {
    _core.fallbackColor = RCTUIColorFromSharedColor(newViewProps.fallbackColor);
  }

  // Blur-output rounded clipping (plan §31). Physical corners only, mirroring the Android
  // manager; RTL logical corners and percentage radii are a documented v1 limitation.
  const auto &radii = newViewProps.borderRadii;
  CGFloat uniform = PBResolveRadius(radii.all, 0);
  [_core setCornerRadiiWithTopLeft:PBResolveRadius(radii.topLeft, uniform)
                          topRight:PBResolveRadius(radii.topRight, uniform)
                       bottomRight:PBResolveRadius(radii.bottomRight, uniform)
                        bottomLeft:PBResolveRadius(radii.bottomLeft, uniform)];

  [super updateProps:props oldProps:oldProps];
}

#pragma mark - Commands

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  RCTParityBlurViewHandleCommand(self, commandName, args);
}

- (void)refresh
{
  [_core refresh];
}

@end
