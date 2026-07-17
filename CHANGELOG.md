# Changelog

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
