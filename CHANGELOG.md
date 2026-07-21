# Changelog

## 0.1.5

### Fixed

- **iOS: `BlurView` rendered as solid magenta on iPhone 11 (and other A13-class GPUs), while the
  identical code rendered a correct blur on iPhone 14 Pro.** This is distinct from the 0.1.4 magenta
  fix (a *transient* re-present race): this one was **persistent from the very first frame** on the
  affected devices. Root cause: the post-process pass (fractional crop + saturation + overlay) was a
  **compute kernel writing its result directly into the `.bgra8Unorm` CAMetalLayer drawable** via
  `texture.write`. Compute-writing a bgra8Unorm *drawable* is silently dropped on some Apple GPUs
  (verified on device on the A13/iPhone 11) — the drawable is then presented having never been
  written, i.e. undefined GPU memory, which renders as saturated magenta on Apple silicon. The A16
  (iPhone 14 Pro) happens to honor the same write, which is exactly why the bug was invisible on the
  calibration reference device and only surfaced once the library ran on an older phone.

  Fixed by making the post pass a **render pass**: a fullscreen-triangle vertex + fragment shader
  that writes the drawable as a **render target** (universally supported across Apple GPU families)
  instead of a compute `texture.write`. The fragment math is byte-identical to the previous kernel
  (`[[position]].xy` is the pixel centre, equal to the kernel's `float2(gid) + 0.5`), so
  cross-platform parity and the M5 calibration constants are unchanged. Verified on device: an
  identical, correct blur now renders on both iPhone 11 (A13, previously magenta) and iPhone 14 Pro
  (A16, no regression). General rule, now documented in the shader source: never
  compute-`texture.write` a CAMetalLayer drawable — render into it.

## 0.1.4

### Fixed

- **iOS: solid magenta instead of a blur, on physical devices only.** The re-present path
  (`representOnly()` — used when `saturation`, `overlayColor` or a radius-mask prop changes without
  needing a recapture) guarded on `dstTexture != nil`. That is not the same question as *"does this
  texture hold a blurred result?"*: the texture becomes non-nil the moment it is **allocated**, and
  **Metal does not zero a freshly created texture**. The Gaussian blur is only encoded into it on a
  capture pass (`uploadSnapshot: true`), so a re-present landing before the first capture finished —
  or after a resize reallocated the textures — sampled **undefined GPU memory**.

  The Simulator hands back zeroed pages, so this was invisible there; a real Apple GPU hands back
  garbage, which renders as saturated magenta over the whole blur region. Reported as "works in the
  simulator, pink screen on device", and it appeared transiently whenever the app re-rendered.

  Fixed by tracking whether `dstTexture` actually holds an encoded blur: set only on a branch that
  genuinely encoded work into it, cleared whenever the textures are reallocated, and required before
  any re-present. This is a class of bug the Simulator structurally cannot catch — undefined memory
  is only undefined on real hardware.

### Documentation

- `docs/DIAGNOSTICS.md`: added "it works in the Simulator but not on my device" as its own case, and
  noted that **iOS Reduce Transparency** (Settings ▸ Accessibility ▸ Display & Text Size) makes a
  `BlurView` render its flat `fallbackColor` with no blur at all — by design, defaulted OFF in the
  Simulator and commonly ON for real users. The library now says so in the log, once per view.
- Bug reports should include a **screenshot**, not only a log. A prose description of a visual defect
  ("no blur" vs "weak blur" vs "a solid colour") cost a full round-trip to disambiguate.

## 0.1.3

### Fixed

- **React Native 0.81 builds now work without a patch.** The codegen spec declared the `refresh`
  command's ref as `React.ComponentRef<...>`; RN 0.81's codegen matches this type by NAME and
  accepts only `React.ElementRef<...>`, hard-failing the whole build with `The first argument of
  method refresh must be of type React.ElementRef<>`. Verified by running each React Native's own
  parser against the spec: `ElementRef` yields all 8 props plus the `refresh` command on **both**
  0.81 and 0.85, so it is strictly the more compatible spelling. (React 19's types deprecate
  `ElementRef` in favour of `ComponentRef` — do not "modernize" this back; codegen does not care
  about the deprecation, only the name.)

### Added

- **Runtime diagnostics — no rebuild, works on release builds.** A `BlurView` showing no blur looks
  identical on screen whether it never captured, captured something empty, or captured fine and
  faithfully presented an *unblurred* snapshot because `blurRadius` resolved to 0. Only a log can
  separate those. See the new [docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md).

  - Android: `adb shell setprop log.tag.ParityBlur DEBUG` then `adb logcat -d | grep ParityBlur`.
  - iOS: launch argument `-ParityBlurDebug YES` (or env `PARITY_BLUR_DEBUG=1`).

  Logs the props as received by native (which immediately proves or disproves a broken prop bridge),
  device API level and real-blur support, the full capture plan geometry, the presented result, and
  the *reason* any capture or draw was skipped.

- **Two self-diagnosing warnings**, emitted even with diagnostics off, because both states are
  otherwise invisible and look like "the library does nothing":
  - a `BlurView` still measuring zero-area 1.5s after attach (almost always a collapsed *parent*,
    not the BlurView's own style — reports the parent's measured size too);
  - `blurRadius` resolving to no-blur while a real blur was requested, which is the exact signature
    of props not reaching native.

### Documentation

- New [docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md): how to enable diagnostics, what a healthy log looks
  like, a table mapping each failure signature to its cause, and the four things to include in a bug
  report.
- Clarified that **`fallbackColor` not appearing is not evidence of a bug** — on API 31+ it is
  deliberately never painted, so its absence tells you nothing. This has misled at least one report.

### Internal

- Added `example/src/screens/SheetBackdropReproScreen.tsx` (`FORCE_SCREEN='sheetrepro'`): a faithful
  transcription of the reported sheet-backdrop layout — opacity-animated backdrop parent,
  full-screen `BlurView` sibling below an upward-translating panel, `mode="live"` — with a flag to
  toggle the opacity-animated parent for a controlled comparison. Verified blurring correctly on a
  physical Pixel 6a (RN 0.85): an opacity-animated ancestor does **not** break the capture pipeline.

## 0.1.2

### Fixed

- **Full-window backdrop behind a transform-animated sheet/modal no longer freezes a partial blur.**
  A `BlurView` used as a transparent full-window backdrop inside a host that animates a transform
  (a `@gorhom/bottom-sheet` container, a `transparentModal` transition) could capture while it was
  still partly outside the window. `expandCaptureRect` clamps the capture to the target bounds, so
  the result covered only a band of the view — and in `mode="static"` that band was permanent,
  because nothing re-captured afterwards: `onSizeChanged` fires on size changes and `onLayout` on
  left/top changes, but a transform is a draw-time matrix that changes neither. Symptoms were a blur
  covering only part of the window (the rest sharp), blurred content presented at a displaced
  offset, or no blur at all. Fixed on Android and iOS:

  - `cropRectFor` is now intersected with the snapshot's own extent. Previously the crop was derived
    from the *unclamped* visible rect while the snapshot came from the *clamped* capture rect, so a
    partly-off-window view selected pixels that were never captured and the band was drawn
    displaced. This is an identity whenever the view is inside the target, so no output changes for
    layouts that already worked and the calibrated parity in `docs/CALIBRATION_REPORT.md` is
    unaffected.
  - A capture that the target bounds would clamp is no longer baked while the view is still moving;
    it is deferred until the geometry settles. Views fully inside the target are unaffected and are
    not delayed.
  - The view's window position is now watched, which is the only reliable way to observe an ancestor
    transform. On Android this uses the existing shared pre-draw listener (idle cost is unchanged —
    still 0 rendered frames over 6s of idle). On iOS a display link is armed only while a view is
    still clamped and torn down as soon as it settles, so a settled window keeps no links.

### Documentation

- New [docs/BOTTOM_SHEET_BACKDROP.md](docs/BOTTOM_SHEET_BACKDROP.md): the full-window backdrop
  layout (as distinct from the Quick Start's "the BlurView *is* the panel" pattern), a
  `@gorhom/bottom-sheet` recipe, and the common pitfalls — a parent collapsing to height 0 and
  taking the backdrop with it, a sheet blurred into its own backdrop, and core `<Modal>` being a
  separate native window.
- `docs/LIMITATIONS.md`: the claim that a software canvas "silently skips" `HARDWARE` bitmaps on
  Android recapture is now marked as an unverified hypothesis rather than documented behaviour —
  `BaseCanvas.throwIfHwBitmapInSwMode` throws rather than skipping, and React Native decodes to
  `ARGB_8888` by default, so the gap is narrower than the previous wording implied. Also notes the
  discriminator: this gap can only affect regions where `Image`s are, never text.

### Internal

- Added `cropRectFor` fixtures covering partially-off-target views (both above and below the
  window), shared by the TypeScript, Kotlin and Swift suites. The previous round-trip invariant was
  vacuous for this case — `cropRectToViewPx` recovers the visible rect algebraically whether or not
  the snapshot contains those pixels — which is why this shipped; the new fixtures assert
  containment instead.
- Added `example/src/screens/OverlayBackdropScreen.tsx` (`FORCE_SCREEN='overlay'`) as a
  device-repro harness for the backdrop layout.

## 0.1.1

- Fix `repository` URL in `package.json`.

## 0.1.0

- Initial release: cross-platform calibrated backdrop blur (Milestones M0–M8).
