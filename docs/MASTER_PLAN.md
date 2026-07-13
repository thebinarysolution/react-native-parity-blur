# Revised Master Plan — react-native-parity-blur

## 1. Objective

Build a reusable React Native blur package named:

`react-native-parity-blur`

Workspace:

`/Volumes/Samsung/PROJECTS/NATIVE_BLUR/react-native-parity-blur`

The package must provide a cross-platform backdrop blur component with one canonical blur definition across iOS and Android.

Primary goals:

1. The same public blur props should produce perceptually matched blur output across supported iOS and Android devices.
2. Blur semantics must be explicit and deterministic rather than inherited from hidden platform-specific material/tint behavior.
3. Resource usage must remain lazy:
    * no heavy engine initialization at JS import time,
    * no GPU resources until a blur view actually needs them,
    * no ongoing frame work for static blur after capture,
    * no live scheduler work when no live blur view is visible.
4. Heavy resources must be shared process-wide where appropriate.
5. Capture scheduling and snapshots must be coordinated per native window.
6. The package must support many simultaneous blur instances.
7. Static snapshot mode is the default.
8. Live blur is opt-in.
9. Android real blur is supported only on API 31+.
10. Android API < 31 uses fallbackColor; do not build a CPU blur subsystem.
11. iOS must use public APIs only. No private API, KVC hacks, or _UICustomBlurEffect.
12. React Native 0.76+ and New Architecture/Fabric are the primary target.
13. Legacy architecture compatibility is a non-goal for v1 unless scaffold-generated support works without architectural compromise or meaningful maintenance cost.

## 2. Product Contract

The package should expose one canonical blur model:

`blurRadius` = Gaussian sigma in dp

The same blurRadius means the same intended Gaussian sigma on both platforms.

Public contract:

> Same canonical props and equivalent source content produce perceptually matched cross-platform blur output within documented calibration tolerances.

Do not promise exact pixel identity across:

* operating-system versions,
* GPU vendors,
* device scales,
* source-rasterization backends,
* wide-gamut display pipelines,
* UIKit vs HWUI/Skia rendering differences.

The package should target perceptual parity and bounded image-difference thresholds under controlled reference scenes.

## 3. Why This Package Exists

Existing React Native blur implementations produce visibly different results across iOS and Android because platform backends do not share one blur definition.

Known issues include:

* Android libraries may blur heavily downscaled bitmaps.
* Some apply blurAmount directly to a backend radius despite backend-specific conversion semantics.
* Android implementations may add hidden overlay tints.
* iOS implementations may rely on system materials whose visual behavior is intentionally platform-specific.
* Some iOS implementations use private APIs such as _UICustomBlurEffect.
* Android HWUI/Skia and iOS blur engines may use different radius/sigma conventions.
* Color-space behavior can differ.
* Downsampling and resampling can create banding and edge differences.
* Premultiplied-alpha behavior can differ.
* Native system materials are not designed for pixel parity across platforms.

This package must define the pipeline itself.

## 4. Core Architecture

Use two thin native backends driven by one canonical mathematical and compositing model.

High-level architecture:

```
React Native JS
    │
    ▼
ParityBlurView native instance
    │
    ├── props
    ├── children
    ├── presentation surface
    ├── lightweight lifecycle state
    └── per-instance output resources
             │
             ▼
Process-wide BlurEngine
    │
    ├── global backend resources
    │
    └── per-window WindowBlurContext
             │
             ├── active blur registry
             ├── one frame scheduler
             ├── capture planner
             ├── exclusion registry
             ├── coordinate resolver
             ├── generation tracking
             ├── backpressure
             └── shared source snapshots
```

Important distinction:

* BlurView instances are not singletons.
* Heavy backend machinery is shared.
* Window-specific capture state is not global.
* Each native window receives its own lightweight WindowBlurContext.
* Global GPU/backend resources may remain process-wide.

## 5. Canonical Blur Mathematics

### 5.1 Public unit

`blurRadius` = Gaussian sigma in dp

Common conversion:

```
sigmaPx = blurRadius × displayScale
```

If the source snapshot is downsampled by linear factor D:

```
sigmaSnapshot = sigmaPx / D
```

The blur backend receives a parameter derived from sigmaSnapshot.

### 5.2 Android conversion

For Android API 31+ using `RenderEffect.createBlurEffect(...)`, begin with the current HWUI conversion hypothesis:

```
sigma ≈ 0.57735 × radiusPlatform + 0.5
```

Therefore the provisional inverse is:

```
radiusPlatform ≈ (sigmaSnapshot - 0.5) / 0.57735
```

However:

* Do not expose this conversion publicly.
* Do not hard-code it throughout the backend.
* Treat it as a calibration implementation detail.
* Confirm it empirically in the parity milestone.
* Allow version-aware calibration if Android behavior differs by API level.

Use a dedicated abstraction such as:

`AndroidBlurCalibration.radiusForSigma(...)`

Possible future internal calibration groups:

```
API 31–33
API 34–35
API 36+
```

The public API remains stable even if internal conversion constants change.

Clamp invalid or non-positive backend radii safely.

Very small requested sigma values may require:

* no-op blur,
* minimum supported radius,
* or calibrated approximation.

Finalize this during parity calibration.

### 5.3 iOS conversion

For MPSImageGaussianBlur:

```
sigma = sigmaSnapshot
```

Treat MPS sigma as the native starting point, but empirically verify final visual equivalence because:

* snapshot rasterization differs,
* downsampling differs,
* texture formats differ,
* color transfer behavior differs,
* resampling differs.

## 6. Canonical Image Pipeline

Both platforms must conceptually follow the same ordered pipeline.

1. Resolve blur view bounds
2. Resolve capture target
3. Convert coordinates
4. Expand capture region for Gaussian support
5. Exclude registered blur presentation surfaces
6. Capture source content
7. Downsample using defined policy
8. Apply Gaussian blur
9. Apply exact saturation transform
10. Apply exact overlay compositing
11. Crop valid center region
12. Upsample using defined policy
13. Apply final rounded clipping
14. Present result

The exact ordering must not vary silently between platforms.

## 7. Gaussian Support and Capture Expansion

Do not capture only the visible blur-view rectangle.

A real blur near the edge needs neighboring pixels outside the visible blur bounds.

For requested visible region R, calculate an expanded capture region:

```
captureRect = expand(R, supportMargin)
```

Initial support rule:

```
supportMarginPx ≈ ceil(K × sigmaPx)
```

Start with:

```
K = 3
```

but treat the exact value as an internal quality/calibration parameter.

Pipeline:

```
visible blur bounds
        ↓
expand by Gaussian support
        ↓
capture expanded region
        ↓
downsample
        ↓
blur
        ↓
crop back to visible region
        ↓
present
```

This is required for correct edge behavior.

TileMode.CLAMP or equivalent remains necessary for the outer edge of the expanded capture, but CLAMP alone is not a substitute for capture expansion.

## 8. Edge Semantics

Both backends must use equivalent edge behavior.

Android: `TileMode.CLAMP`

iOS: Use equivalent clamp-to-edge / clamp-to-extent semantics in the selected Metal pipeline.

Do not use:

* mirrored edges,
* transparent black edges,
* implicit darkening,
* backend-default behavior without verification.

## 9. Color Pipeline

Do not assume that:

* "sRGB" automatically means gamma-space convolution,
* an untagged Metal texture guarantees the desired arithmetic,
* Core Image working-space settings apply to an MPS pipeline,
* bgra8Unorm and bgra8Unorm_srgb behave equivalently.

Define and calibrate the color pipeline explicitly.

Target canonical behavior:

1. Normalize captured input into a documented BGRA representation.
2. Define whether convolution operates on:
    * sRGB-encoded values, or
    * linear-light values.
3. Match Android's observed pipeline as closely as possible.
4. Select Metal texture formats accordingly.
5. Define alpha representation explicitly.
6. Define premultiplication behavior explicitly.
7. Validate with controlled gradients and alpha-edge fixtures.
8. Lock final choices only after empirical cross-platform calibration.

The iOS implementation must not claim gamma-space parity until the calibration harness confirms it.

Test at minimum:

```
black → white gradient
red → green gradient
blue → yellow gradient
transparent → opaque edge
50% alpha shape over color
high-frequency checkerboard
normal photographic image
wide-gamut/P3 fixture where supported
```

## 10. Saturation Semantics

Saturation must be explicit and deterministic.

Public prop: `saturation={1}`

Where: `1` = neutral, `0` = grayscale, `>1` = increased saturation.

Use the exact same matrix semantics on both platforms.

Define:

* luminance coefficients,
* matrix order,
* alpha handling,
* premultiplied/unpremultiplied behavior.

Do not merely use "Android ColorMatrix and iOS equivalent" without locking exact coefficients.

Choose one canonical coefficient set and use it on both backends.

Candidate — Rec. 709: `R = 0.2126, G = 0.7152, B = 0.0722`

Finalize after parity tests.

## 11. Overlay Semantics

No hidden tint is allowed.

Public prop: `overlayColor`. Default: none / transparent.

Overlay must use the same compositing order and alpha math on both platforms.

Canonical order:

```
blur → saturation → overlay source-over → final clipping
```

Define source-over math explicitly and ensure equivalent premultiplied-alpha handling.

Presets may later emulate material-like appearances, but presets must resolve to explicit package props.

Example: `darkMaterialPreset → blurRadius + saturation + overlayColor`

No backend-specific hidden behavior.

## 12. Downsampling

Public API: `downsample="auto"` or explicit advanced numeric override.

Supported internal factors: `1 | 2 | 4 | 8`

Do not use a fixed 6× downsample.

Auto selection should consider:

* requested sigma,
* display scale,
* capture area,
* quality mode,
* minimum useful snapshot sigma,
* memory pressure.

Initial constraint: `sigmaSnapshot should generally remain >= approximately 1 px` — but this is not the only rule.

The implementation must also define:

* source coordinate rounding,
* capture rectangle rounding,
* reduction filter,
* upsampling filter,
* crop coordinate mapping,
* transform mapping.

Use equivalent sampling policies on both platforms as far as backend APIs allow.

Do not assume equal sigma guarantees equal appearance if the downsample pipeline differs.

## 13. Quality API

Prefer a consumer-friendly quality API while retaining advanced override capability.

Recommended prop: `quality="balanced"` with values `high | balanced | performance`.

Suggested internal tendencies:

```
high        → prefer 1× or 2×
balanced    → prefer 2× or 4×
performance → prefer 4× or 8×
```

Exact selection remains adaptive.

Keep `downsample="auto"` as default. Allow explicit numeric override for advanced users if desired.

## 14. Android Backend

Language: Kotlin. Supported real blur: API 31+. Older Android: fallbackColor only. Do not implement CPU blur.

### 14.1 Android capture strategy

Use a RenderNode-based capture path where feasible.

Concept:

```
target hierarchy
    ↓
record into downscaled RenderNode
    ↓
apply RenderEffect
    ↓
GPU / RenderThread presentation
```

Requirements:

* avoid unnecessary bitmap readback,
* avoid CPU blur,
* avoid fixed 6× downsampling,
* avoid hidden overlay tint,
* use CLAMP edges,
* expand capture region for kernel support,
* exclude blur presentation surfaces,
* never invalidate recursively from draw().

### 14.2 Android self-exclusion

All registered ParityBlurView presentation surfaces must be excluded from backdrop capture.

Do not exclude their children from normal UI composition.

Conceptually:

```
capture backdrop      → excludes blur-result surfaces
normal UI composition → includes BlurView children
```

Implement using a robust tagged-canvas / capture-pass mechanism.

Do not depend on fragile global booleans if nested drawing can occur.

Prefer a capture-context marker associated with the recording pass.

### 14.3 Android live scheduling

Do not register one independent OnPreDrawListener per blur instance.

Use: one capture/frame coordinator per active native window.

The window context owns one OnPreDrawListener. It:

1. collects visible live blur instances,
2. resolves capture requests,
3. coalesces duplicate work,
4. computes capture plan,
5. captures shared targets where possible,
6. distributes results.

### 14.4 Android static mode

Static mode captures only when necessary.

Capture triggers:

* first valid mount,
* explicit refresh(),
* relevant layout/size change,
* target change,
* window migration,
* selected prop changes requiring recapture.

Do not capture immediately merely because onAttachedToWindow() fired.

Use a state machine:

```
DETACHED → ATTACHED_WAITING_LAYOUT → WAITING_STABLE_FRAME → CAPTURE_PENDING → CAPTURED
```

Capture only when:

```
attached AND window available AND view laid out AND size > 0
AND target valid AND target laid out
AND next appropriate pre-draw/frame boundary reached
```

Coalesce repeated requests. Example:

```
refresh(); refresh(); layout change; refresh()
→ one capture on next valid frame
```

### 14.5 Android resources

Process-wide engine may contain:

* global calibration state
* effect cache if profiling proves useful
* memory-pressure integration
* weak per-window contexts

Per-window context may contain:

* capture coordinator
* active view registry
* capture-plan state
* shared frame state

Per-instance resources may contain:

* presentation node
* output node/texture-equivalent state
* lightweight generation counters

Do not introduce a bitmap pool unless a real implementation path requires bitmaps. Do not pool resources merely because pooling sounds efficient. Measure first.

If pooling is used:

* key by rounded dimensions and format,
* cap retained memory,
* clear on trim-memory,
* avoid retaining huge rare allocations.

## 15. iOS Backend

Languages: Swift; ObjC++ only where required for Fabric glue.

Core blur backend: Metal, MPSImageGaussianBlur. No private API.

### 15.1 iOS global engine

Use `BlurEngine.shared`, lazily created only when the first valid blur view actually requires blur resources.

Global resources may include:

* MTLDevice
* MTLCommandQueue
* kernel cache
* shared backend configuration
* memory-pressure handling
* weak window-context registry

Do not initialize these at JS import, at module load, or merely because the package is linked.

### 15.2 iOS per-window context

Use a separate WindowBlurContext for each active UIWindow.

Concept:

```
BlurEngine.shared
    ├── MTLDevice
    ├── MTLCommandQueue
    ├── kernel cache
    └── WeakMap<UIWindow, WindowBlurContext>
```

Each window context owns:

* active blur registry
* capture planner
* visibility state
* frame scheduler
* shared CADisplayLink participation
* capture generations
* backpressure state
* shared snapshots
* exclusion state

Support multiple windows/scenes without cross-window assumptions.

### 15.3 iOS snapshot provider abstraction

Do not hard-wire all architecture to one capture method.

Define a provider abstraction such as:

```swift
protocol SnapshotProvider {
    func capture(...)
}
```

Initial implementations may include:

* DrawHierarchySnapshotProvider
* LayerRenderSnapshotProvider

The engine may choose the provider based on capability or documented limitations.

The architecture must allow future optimized providers without changing the public JS API.

### 15.4 iOS capture strategy

Static mode may use region capture at downsampled resolution.

Live mode must not blindly assume one full-window snapshot every frame. Instead use a per-window capture planner.

For all visible live blur instances:

1. collect requested expanded regions,
2. group by capture target,
3. calculate individual region cost,
4. calculate union rectangle,
5. compare union area against full target/window area,
6. choose capture strategy.

Possible strategies:

* A. individual region captures
* B. union-rectangle capture
* C. full-target/full-window capture

Example heuristic:

```
if unionArea / targetArea < threshold: capture union
else: capture full target
```

The exact threshold must be profiled and configurable internally.

### 15.5 iOS direct presentation path

The implementation must explicitly avoid accidental per-frame GPU → CPU readback in live mode.

Forbidden live pipeline (if it requires per-frame GPU readback):

```
MTLTexture → CGImage → UIImage → CALayer.contents
```

Preferred architecture should investigate and select a direct GPU presentation path such as:

* CAMetalLayer-backed internal presentation surface, or
* MTKView-backed internal presentation surface, or
* custom Metal compositing into CAMetalDrawable

Requirement: no unnecessary GPU → CPU readback in the steady-state live presentation path.

The exact presentation strategy must be proven in Milestone 0 before full implementation proceeds.

## 16. iOS Self-Exclusion

This is mandatory.

Without exclusion, live snapshots can recursively capture previous blur output:

```
frame 1: source → blur
frame 2: source + previous blur → blur
frame 3: source + accumulated blur → blur
```

This can cause recursive darkening, excessive blur, ghosting, temporal feedback.

Rules:

1. Exclude the requesting BlurView presentation surface.
2. Exclude all registered ParityBlurView blur-result presentation surfaces.
3. Preserve BlurView children in normal UI composition.
4. Capture only backdrop content.
5. Avoid visible hide/show flicker.
6. Avoid state mutation that leaks into the committed UI frame.

Do not assume temporarily setting isHidden = true is acceptable without proving no flicker or transaction side effects.

The exact exclusion strategy must be validated in the feasibility milestone.

## 17. Nested Blur Policy

Define nested behavior explicitly.

For v1: all ParityBlurView blur-result presentation surfaces are excluded from backdrop capture. Therefore nested blur does not promise native-material stacking semantics. Children remain visible normally.

Document: "Nested blur composition is deterministic but does not emulate Apple's layered material system."

Test:

* BlurView inside BlurView
* overlapping BlurViews
* sibling BlurViews
* live + static overlap

## 18. Blur Target Semantics

Public prop: `blurTarget={ref}`

Default: React Native root content target associated with the BlurView's window.

Rules:

1. blurTarget must resolve to a native view.
2. Target and BlurView must belong to the same native window.
3. Cross-window targets are unsupported.
4. Cross-window target mismatch: render fallbackColor, emit a development warning, do not crash.
5. Coordinates must be resolved natively.

Coordinate conversion:

```
BlurView local bounds → window coordinates → target-local coordinates
```

Account for scroll offsets, transforms where supported, RTL, nested containers, partial offscreen position, clipping, device scale.

Document unsupported transform cases if exact capture is impossible.

## 19. Capture Planner

Introduce a formal capture-planning layer on both platforms.

Concept:

```
CapturePlanner
    ├── collectRequests()
    ├── groupByTarget()
    ├── expandForKernelSupport()
    ├── computeIndividualCost()
    ├── computeUnionRect()
    ├── computeFullTargetCost()
    └── choosePlan()

CapturePlan
    ├── target
    ├── captureRect
    ├── downsample
    ├── participatingViews
    └── outputSlices
```

This is particularly important for multiple simultaneous live blur views.

## 20. Static Mode

Default: `mode="static"`

Behavior:

* capture after first valid stable layout/frame,
* blur once,
* display cached result,
* perform zero ongoing frame work afterward.

Recapture on: refresh(), relevant layout change, target change, selected blur-pipeline prop changes, window migration, resource invalidation.

Do not recapture merely because unrelated React renders occur.

refresh() should schedule a coalesced next-valid-frame capture rather than synchronously forcing expensive work.

## 21. Live Mode

Opt-in: `mode="live"`

Live mode uses per-window coordination.

Requirements:

* one scheduler per active window,
* shared capture planning,
* frame throttling,
* stale-frame dropping,
* backpressure,
* visibility pause,
* app/scene lifecycle pause.

Default: `maxFps={30}`

Do not assume every display-link callback should produce work. Respect elapsed time.

## 22. Backpressure

This is mandatory.

If capture + blur takes longer than the requested frame interval, do not queue an unlimited sequence of stale frames. Use at most a small bounded number of in-flight frames.

Recommended initial policy: maximum 1 in-flight capture/blur job per window.

If another frame is requested while work is in flight:

```
mark latestFrameRequested = true
drop intermediate frame requests
```

On completion:

```
if latestFrameRequested: process newest current state
else: remain idle
```

Prefer dropping stale frames over increasing visual latency.

## 23. Generation Tracking

Async results must never be displayed after becoming stale.

Track generations such as: captureGeneration, layoutGeneration, targetGeneration, windowGeneration.

When work begins: record generation token. Before presentation:

```
if token != current generation: discard result
```

Required for: scrolling, layout changes, target replacement, orientation changes, fast detach/reattach, mode changes, window changes.

## 24. Visibility Rules

A live blur instance is considered active only when the visibility heuristic passes.

At minimum:

```
attached to window
window != nil
hidden == false
alpha > small threshold
bounds width > 0
bounds height > 0
intersects visible window bounds
app active
scene active where applicable
```

Optionally account for ancestor clipping if practical without excessive traversal cost.

When no live blur instances are active: pause scheduler, release transient snapshots, perform no frame capture work.

## 25. Accessibility

iOS: if Reduce Transparency is enabled, render fallbackColor and do not run blur machinery for that instance. Observe accessibility-setting changes while app is running.

Android: if platform-specific accessibility policy requires fallback behavior, document and support where appropriate, but do not invent hidden behavior.

## 26. Memory Pressure

iOS — on memory warning:

* drop transient snapshots
* drop reusable large textures
* trim kernel caches if appropriate
* release inactive window-context resources

Android — on ComponentCallbacks2 / onTrimMemory:

* drop transient snapshots
* trim pools
* release inactive shared capture resources

Detached views must release per-instance resources.

Window contexts should disappear when no active instances remain AND no in-flight work remains.

Use weak window references to avoid leaks.

## 27. Laziness Requirements

Before first active BlurView:

* no MTLDevice initialization caused by package import
* no MTLCommandQueue initialization
* no CADisplayLink
* no Android capture coordinator
* no large textures
* no snapshot buffers
* no bitmap pool
* no frame listeners

First heavy initialization occurs only after a BlurView is: attached AND associated with a valid window AND laid out AND visible/eligible AND actually requires real blur.

Android API < 31 fallback-only instances must not initialize real blur machinery.

iOS Reduce Transparency fallback-only instances must not initialize unnecessary blur machinery.

## 28. Public TypeScript API

```tsx
<BlurView
  blurRadius={16}
  mode="static"
  overlayColor="rgba(16,16,16,0.35)"
  saturation={1}
  quality="balanced"
  downsample="auto"
  maxFps={30}
  fallbackColor="rgba(12,12,12,0.9)"
  blurTarget={ref}
  style={{ borderRadius: 24 }}
>
  {children}
</BlurView>
```

Types:

```ts
type BlurMode = 'static' | 'live';
type BlurQuality = 'high' | 'balanced' | 'performance';
type BlurDownsample = 'auto' | 1 | 2 | 4 | 8;

interface BlurViewProps {
  blurRadius?: number;         // Gaussian sigma in dp
  mode?: BlurMode;             // default: static
  overlayColor?: string;       // default: transparent
  saturation?: number;         // default: 1
  quality?: BlurQuality;       // default: balanced
  downsample?: BlurDownsample; // default: auto
  maxFps?: number;             // default: 30
  fallbackColor?: string;
  blurTarget?: React.RefObject<any>;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}
```

Validate:

* blurRadius >= 0
* saturation >= 0
* maxFps bounded to sensible range
* downsample allowed values only

Do not silently accept invalid numeric values such as NaN, Infinity, negative radius. Use development warnings and safe production clamping/fallback.

## 29. Imperative API

Expose `ref.current?.refresh()` via a Fabric view command.

Semantics: refresh() schedules a coalesced recapture on the next valid frame. It must not force unsafe synchronous capture during JS command handling.

Repeated calls before capture coalesce to one capture.

## 30. Child Rendering

ParityBlurView must be a native host view capable of rendering React Native children above the blur result.

Layering:

```
backdrop source
    ↓
blur result presentation surface
    ↓
React Native children
```

Children must remain sharp.

The capture exclusion system must exclude blur-result surfaces without unintentionally removing children from normal UI composition.

## 31. Rounded Corners and Clipping

Support `borderRadius`, preferably individual corners (borderTopLeftRadius, borderTopRightRadius, borderBottomLeftRadius, borderBottomRightRadius).

Define whether child clipping follows standard React Native overflow semantics.

Do not automatically clip children merely because the blur-result texture requires rounded masking unless React Native style semantics require it.

Blur output clipping and child clipping should be treated as separate concerns.

## 32. Package Structure

Use create-react-native-library as the scaffold starting point.

```
react-native-parity-blur/
├── package.json
├── react-native.config.js
├── src/
│   ├── index.ts
│   ├── BlurView.tsx
│   ├── types.ts
│   ├── defaults.ts
│   └── ParityBlurViewNativeComponent.ts
│
├── ios/
│   ├── ParityBlurView.mm
│   ├── ParityBlurView.h
│   ├── BlurEngine.swift
│   ├── WindowBlurContext.swift
│   ├── CapturePlanner.swift
│   ├── SnapshotProvider.swift
│   ├── DrawHierarchySnapshotProvider.swift
│   ├── LayerRenderSnapshotProvider.swift
│   ├── MetalBlurPipeline.swift
│   ├── MetalPresentationSurface.swift
│   ├── BlurCalibration.swift
│   └── ColorPipeline.swift
│
├── android/
│   └── src/main/java/com/parityblur/
│       ├── ParityBlurViewManager.kt
│       ├── ParityBlurView.kt
│       ├── BlurEngine.kt
│       ├── WindowBlurContext.kt
│       ├── CapturePlanner.kt
│       ├── AndroidBlurCalibration.kt
│       ├── CaptureContext.kt
│       └── ColorPipeline.kt
│
└── example/
    ├── src/
    │   ├── screens/
    │   │   ├── BasicStaticScreen.tsx
    │   │   ├── LiveHeaderScreen.tsx
    │   │   ├── BottomSheetScreen.tsx
    │   │   ├── MultiBlurScreen.tsx
    │   │   ├── NestedBlurScreen.tsx
    │   │   ├── CalibrationScreen.tsx
    │   │   ├── GradientCalibrationScreen.tsx
    │   │   ├── LifecycleScreen.tsx
    │   │   └── PerformanceScreen.tsx
    │   └── assets/
    │       ├── reference-photo.*
    │       ├── grayscale-gradient.*
    │       ├── color-gradients.*
    │       ├── alpha-edge.*
    │       └── checkerboard.*
    └── ...
```

Adjust exact scaffold files to the generated library structure rather than fighting the scaffold unnecessarily.

## 33. Milestone 0 — Feasibility Spikes

Do this before implementing the full package. Purpose: prove the risky assumptions first.

**Android spike** — prove:

* RenderNode capture
* downscaled capture
* RenderEffect blur
* self-exclusion
* two simultaneous BlurViews
* live scrolling case

Confirm: no recursive invalidation, no infinite draw loop, no unexpected black overlay, acceptable performance.

**iOS spike** — prove:

* snapshot provider
* downsampled capture
* MPSImageGaussianBlur
* direct GPU presentation
* self-exclusion
* two simultaneous BlurViews
* live scrolling case

Mandatory proof points:

1. No recursive blur feedback.
2. No visible hide/show flicker.
3. Children remain sharp.
4. Two overlapping blur views behave deterministically.
5. Nested blur policy behaves as documented.
6. Live presentation does not require accidental per-frame GPU → CPU readback.
7. 30 FPS live mode is technically viable on representative hardware.
8. Color pipeline can be controlled sufficiently for calibration.

Stop and revise architecture if these proof points fail. Do not proceed blindly to full implementation.

## 34. Milestone 1 — Scaffold

Create: Fabric-first library, example app, placeholder native host view, child rendering, native prop plumbing, Fabric command for refresh(), TypeScript public wrapper.

Verify: iOS build, Android build, placeholder native view renders, children render, props reach native side, refresh command reaches native view.

Do not implement real blur yet.

## 35. Milestone 2 — Canonical Math and Pipeline Specification

Before backend work spreads, implement shared documented rules for:

* sigma conversion
* display scale
* capture expansion
* coordinate rounding
* downsample selection
* crop mapping
* saturation matrix
* overlay compositing
* alpha handling
* generation rules

Create test fixtures for pure calculations where possible.

The two native backends may use separate languages but must implement the same documented rules.

## 36. Milestone 3 — Android Static Backend

Implement: API 31+ real blur, API <31 fallbackColor, RenderNode capture, expanded capture region, downsampling, RenderEffect, CLAMP, self-exclusion, static lifecycle, refresh(), layout recapture, rounded clipping, children above blur.

Verify: no hidden tint, no banding regression, no ongoing work after static capture, fallback path allocates no real blur machinery.

## 37. Milestone 4 — iOS Static Backend

Implement: lazy BlurEngine, per-window context, SnapshotProvider abstraction, expanded region capture, downsampled snapshot, MPSImageGaussianBlur, direct/efficient presentation path, self-exclusion, static lifecycle, refresh(), rounded clipping, children above blur, Reduce Transparency fallback.

Verify: no private API, no recursive capture, no unnecessary ongoing work after static capture, no stale-result presentation.

## 38. Milestone 5 — Parity Calibration

Do this before live mode is fully hardened.

Calibration screen must include fixed blur radii: 4, 8, 16, 24, 32 dp.

Test assets: reference photograph, black-white gradient, red-green gradient, blue-yellow gradient, alpha edge, checkerboard/high-frequency detail, P3/wide-gamut fixture where supported.

Capture on: iOS simulator, iOS physical device, Android API 31+, multiple Android API levels where practical, Android physical device.

Compare with: side-by-side review, pixel difference, SSIM, optional perceptual color metric such as ΔE.

Do not require exact pixel identity. Define acceptance thresholds after baseline measurement.

Calibration tasks: confirm Android radius conversion, confirm iOS sigma mapping, confirm color-pipeline configuration, confirm downsample behavior, confirm sampling filters, confirm overlay math, confirm saturation matrix, confirm edge handling.

Lock internal constants only after this milestone.

## 39. Milestone 6 — Shared Live Coordinator

Implement live mode only after static parity is credible.

Both platforms: per-window active registry, one scheduler per window, capture request collection, capture planning, shared snapshots where beneficial, visibility filtering, maxFps throttle, generation tracking, backpressure, stale-frame dropping.

iOS: shared CADisplayLink coordination. Android: one OnPreDrawListener per active window context.

Do not create one independent scheduler per blur view.

## 40. Milestone 7 — Lifecycle and Performance Hardening

Test: attach, detach, rapid remount, navigation push/pop, tab switching, background/foreground, scene inactive/active, rotation, layout changes, target changes, memory pressure, many BlurViews, zero live BlurViews, offscreen BlurViews.

Verify: scheduler pauses, snapshots release, window contexts release, no stale presentation, no retained detached views, no listener leaks, no display-link leaks.

## 41. Milestone 8 — Polish

Add: material-like explicit presets, README, API docs, limitations, performance guidance, TypeScript types, example screenshots, package publish preparation.

Only add legacy architecture support if it remains low-cost and does not compromise Fabric-first design.

## 42. Verification Plan

### 42.1 Parity

Run calibration screens on both platforms.

Acceptance based on: controlled fixtures, perceptual similarity, bounded difference thresholds, no severe gradient banding, consistent edge behavior, consistent overlay/saturation behavior.

Avoid the absolute claim "visually indistinguishable at every pixel". Use "perceptually matched within documented tolerance".

### 42.2 Behavior

Required demo screens: static bottom sheet over content, live blurred header over scrolling list, multiple simultaneous BlurViews, overlapping BlurViews, nested BlurViews, explicit blurTarget, fallback path.

### 42.3 Performance

Android: `adb shell dumpsys gfxinfo`, Android Studio profiler where useful.

iOS: Xcode Instruments (Core Animation, Time Profiler, Metal profiling where useful).

Measure: no-blur baseline, static blur, one live blur, multiple live blurs, large region, small region, 1×/2×/4×/8× downsample, 30 FPS throttle.

Do not define performance only as "feels smooth". Record: frame time, main-thread cost, GPU cost, memory, allocation churn, capture time, blur time, presentation time, dropped frames.

### 42.4 Laziness

Add debug-only instrumentation proving:

```
package import                    → no engine initialization
app start without BlurView        → no heavy blur resources
first eligible BlurView           → engine initializes
last live BlurView disappears     → scheduler pauses
detached views                    → per-instance resources release
```

Android API < 31 fallback-only usage must not initialize the real blur backend.

iOS Reduce Transparency fallback-only usage must avoid unnecessary real blur initialization.

## 43. Known Limitations (document up front)

**Cross-window capture** — a blur view cannot capture content from another native window (some React Native Modal configurations, separate UIWindow layers, platform overlays). Fallback: fallbackColor where necessary.

**Surface-backed content** — view-hierarchy capture may not correctly include SurfaceView, some video surfaces, maps, camera previews, external texture surfaces. Document backend-specific limitations.

**Static mode** — static mode captures a snapshot. If the backdrop changes afterward: call refresh() or use mode="live".

**iOS live cost** — iOS live capture is expected to be the most expensive path. Mitigations: region/union capture planning, downsampling, shared per-window snapshots, 30 FPS default, visibility pause, backpressure, stale-frame dropping, static default.

**Nested blur** — deterministic but does not emulate Apple's native material stacking.

**Exact pixel identity** — not guaranteed across OS versions, GPU vendors, device scales, source rasterization systems, wide-gamut pipelines. The goal is calibrated perceptual parity.

## 44. Non-Goals for v1

Do not add: Android CPU blur for API < 31, private iOS blur APIs, automatic native system-material parity, cross-window capture, SurfaceView capture hacks, unbounded live frame queues, per-instance display links, per-instance Android pre-draw schedulers, mandatory legacy RN architecture support.

Keep v1 focused.

## 45. Implementation Guardrails

1. Do not initialize heavy resources at module import.
2. Do not use private iOS APIs.
3. Do not silently add platform-specific tint.
4. Do not use a fixed 6× downsample.
5. Do not capture only exact blur bounds without Gaussian support expansion.
6. Do not create one live scheduler per BlurView.
7. Do not queue unlimited live frames.
8. Do not present stale async results.
9. Do not assume color parity without calibration.
10. Do not hard-code Android conversion logic throughout the codebase.
11. Do not use GPU → CPU readback in the steady-state iOS live presentation path unless profiling proves no viable alternative and the architecture is explicitly revised.
12. Do not let blur-result surfaces recursively enter backdrop snapshots.
13. Do not pool large resources without measured need.
14. Do not compromise Fabric-first architecture for legacy compatibility.
15. Do not claim exact pixel identity.

## 46. Definition of Done

The package is ready for v1 when:

* ✓ Fabric-first example app builds on iOS and Android
* ✓ same public blurRadius has calibrated cross-platform semantics
* ✓ Android API 31+ real blur works
* ✓ Android API <31 fallback works
* ✓ iOS public-API Metal/MPS blur works
* ✓ static mode works
* ✓ live mode works
* ✓ refresh() works
* ✓ multiple BlurViews work
* ✓ overlapping BlurViews work
* ✓ nested behavior is deterministic
* ✓ self-exclusion prevents recursive blur
* ✓ children remain sharp
* ✓ rounded clipping works
* ✓ explicit overlay matches closely
* ✓ explicit saturation matches closely
* ✓ Reduce Transparency fallback works
* ✓ memory pressure handling works
* ✓ live scheduler pauses when inactive
* ✓ no unbounded frame queue exists
* ✓ stale generations are discarded
* ✓ no private API exists
* ✓ no hidden tint exists
* ✓ no heavy engine initialization occurs at JS import
* ✓ calibration harness exists
* ✓ performance measurements are documented
* ✓ limitations are documented

## 47. Execution Instruction

Replace the previous implementation plan with this revised plan.

Before writing production code:

1. Inspect the existing repository state.
2. Preserve any already-correct scaffold or implementation work.
3. Do not rewrite working code unnecessarily.
4. Compare existing code against this revised architecture.
5. Start with Milestone 0 feasibility spikes for unresolved risky assumptions.
6. Report any architectural blocker discovered during the spikes before proceeding to a backend design that violates the guardrails.
7. Implement milestone by milestone.
8. Keep the package Fabric-first.
9. Treat calibration constants as provisional until the parity milestone.
10. Prefer measured behavior over assumptions about undocumented platform internals.

The final objective is a reusable, lazy, lifecycle-safe, performance-conscious React Native backdrop blur package with one canonical public blur model and calibrated perceptual parity across supported iOS and Android platforms.

---

# Model Routing and Milestone Execution Policy

This project uses different models for different milestones based on architectural risk, native-platform complexity, implementation determinism, and cost.

## Mandatory execution rule

Before starting any milestone:

1. Read the Preferred Model specified for that milestone.
2. If the current model matches the preferred model, continue.
3. If the current model does not match:
    * do not begin implementation of that milestone,
    * stop at the milestone boundary,
    * summarize the current repository state,
    * summarize completed work,
    * list unresolved issues,
    * provide the exact next action,
    * request execution to continue with the preferred model.
4. Never silently continue a high-risk milestone using a weaker model merely to avoid switching.
5. A stronger model may be used in place of a weaker preferred model.
6. A weaker model may not replace a stronger preferred model for architecture-critical work unless explicitly approved by the user.
7. Model changes must happen only at clean milestone or sub-milestone boundaries unless escalation is required by a blocker.

## Milestone model assignments

| Milestone | Preferred Model |
|---|---|
| 0 — Feasibility Spikes | Fable 5 Ultracode |
| 1 — Scaffold | Sonnet |
| 2 — Canonical Math & Pipeline Spec | Opus 4.8 Low |
| 3 — Android Static Backend | Sonnet (escalate on listed blockers) |
| 4 — iOS Static Backend | Fable 5 Ultracode (do not downgrade automatically) |
| 5 — Parity Calibration | Opus 4.8 Low (escalate if fundamental backend mismatch) |
| 6 — Shared Live Coordinator | Fable 5 Ultracode |
| 7 — Lifecycle & Performance Hardening | Sonnet (escalate on concurrency/GPU/leak ambiguity) |
| 8 — Polish | Sonnet |

Milestone-specific execution notes:

* **M0**: The model must challenge the plan when implementation evidence contradicts an assumption. Required behavior: inspect → prototype → measure → verify → revise assumption if necessary → only then proceed.
* **M1**: Follow the established plan closely; do not redesign architecture; escalate only on a genuine Fabric/New Architecture blocker.
* **M2**: Preserve one canonical semantic definition across both native backends; escalate before hard-coding unresolved iOS/Android contradictions.
* **M3**: Escalate to Fable 5 Ultracode on: recursive drawing, RenderNode lifecycle ambiguity, Fabric mounting behavior, unexplained GPU/render-thread behavior, self-exclusion failure, coordinate mismatch that cannot be locally explained.
* **M4**: Verify no per-frame GPU→CPU readback, no recursive blur capture, no hidden synchronization stalls, no stale texture presentation, no UIKit transaction flicker, no lifecycle leaks.
* **M5**: Do not blindly tweak constants until screenshots look vaguely similar. Every calibration change must identify the likely source (sigma conversion, color transfer, sampling, capture scale, alpha, overlay, saturation, edge behavior).
* **M6**: Reason about timing and ownership, not just compilation. Do not allow: one scheduler per BlurView, unbounded work queues, stale frame accumulation, detached-view callbacks, cross-window state contamination.
* **M7**: Use Fable 5 Ultracode only for unresolved concurrency, GPU synchronization, Metal lifecycle, RenderThread behavior, race conditions, or persistent memory leaks with unclear ownership.
* **M8**: No major architecture changes during polish; any proposed architecture change is a separate reviewed task.

## Automatic Escalation Policy

Regardless of milestone assignment, escalate from Sonnet or Opus 4.8 Low to Fable 5 Ultracode when any of the following occurs:

1. Two attempted fixes fail for the same underlying issue.
2. The implementation contradicts a core architecture assumption.
3. A native crash has unclear ownership or lifecycle origin.
4. GPU/CPU synchronization behavior is unclear.
5. A Metal texture or drawable lifecycle issue appears.
6. RenderNode behavior differs from the expected capture model.
7. Self-exclusion causes recursive blur, flicker, or missing children.
8. Multiple BlurViews interfere with one another.
9. A race condition or stale-frame issue cannot be locally isolated.
10. Performance is substantially below budget despite the expected architecture.
11. Fixing the issue would require changing public API semantics.
12. Fixing one platform would knowingly break parity with the other.

When escalating, produce a compact handoff containing: current milestone, current subtask, expected behavior, actual behavior, relevant files, changes already attempted, observed logs/errors, current hypothesis, unresolved architectural question. Then continue with the stronger model.

## Cost-Control Rule

Do not use the strongest model for deterministic boilerplate merely because it is available.

Preferred strategy:

```
Fable 5 Ultracode → architecture uncertainty, feasibility, hardest native graphics work, live coordinator
Opus 4.8 Low     → constrained cross-platform reasoning, mathematical semantics, calibration analysis
Sonnet           → deterministic implementation, scaffolding, bounded backend work, lifecycle verification, docs/polish
```

The goal is not to minimize model cost at every individual step. The goal is to avoid expensive architectural mistakes while using lower-cost models for work that has already been sufficiently specified.

---

# Appendix — How the Model Routing Policy executes in this environment (added by Claude, kept for future sessions)

The routing policy is implemented via **orchestrator-delegate**: the interactive session runs on Fable 5 with ultracode enabled (satisfies rule 5 — a stronger model may substitute), and milestones assigned to cheaper models are delegated to subagents pinned to the preferred model:

* **Fable 5 Ultracode** milestones (0, 4, 6): executed directly by the main Fable 5 session, using Workflow orchestration for fan-out/verification.
* **Sonnet** milestones (1, 3, 7, 8): delegated to subagents with `model: 'sonnet'`.
* **Opus 4.8 Low** milestones (2, 5): delegated via Workflow `agent(prompt, { model: 'opus', effort: 'low' })`, which pins both model and reasoning effort.
* **Escalation**: the Fable 5 orchestrator reviews every subagent result at milestone/sub-milestone boundaries; on any Automatic Escalation trigger, it takes the subtask over directly. Handoffs use the compact format defined above and are written to `docs/handoffs/` in the repo.
* Subagents start with no conversation memory: every delegated milestone receives a self-contained brief referencing this plan file, which must be copied into the repo as `docs/MASTER_PLAN.md` during Milestone 1 so any future session (any model) can read it.
* Constraint to respect: a session cannot change its own main-loop model. If the user chooses to run a milestone by switching the app's session model instead of delegation, the mandatory stop-summarize-handoff rule applies literally at the milestone boundary.
