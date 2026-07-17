# Diagnosing "the blur isn't working"

A `BlurView` that shows no blur looks **identical on screen** in at least four completely different
failure modes. A screenshot cannot tell them apart — and neither can we. This page turns "it doesn't
work" into a one-line answer.

**If you are reporting a bug: run the capture in §1 and paste the output.** That is the single most
useful thing you can send, and it usually makes the round-trip unnecessary.

## 1. Turn on diagnostics (no rebuild, works on release builds)

### Android

```bash
adb shell setprop log.tag.ParityBlur DEBUG   # enable
adb logcat -c                                # clear
# → now reproduce the problem in the app ←
adb logcat -d | grep ParityBlur              # capture this output
adb shell setprop log.tag.ParityBlur INFO    # disable again
```

No rebuild, no code change, no debug build required. The property survives until you unset it or
reboot.

> If you see nothing at all, the native view was never created — that is itself the answer, and it
> means autolinking/codegen, not blur. Jump to §3, case E.

### iOS

Xcode ▸ **Edit Scheme** ▸ Run ▸ **Arguments** ▸ *Arguments Passed On Launch* ▸ add:

```
-ParityBlurDebug YES
```

(or *Environment Variables* ▸ `PARITY_BLUR_DEBUG` = `1`). Then read Xcode's console, or:

```bash
log stream --predicate 'eventMessage CONTAINS "ParityBlur"'
```

## 2. What a healthy log looks like

```
D ParityBlur: [97458094] blurRadius=50.0
D ParityBlur: [97458094] mode=live
D ParityBlur: [97458094] attached sdk=36 realBlurSupported=true props{blurRadius=50.0 mode=live
              saturation=1.0 quality=balanced downsample=0 maxFps=30 overlayColor=335544320 ...}
D ParityBlur: engine-init
D ParityBlur: [97458094] plan view=1080x2400 viewLoc=(0,0) target=1080x2400 targetLoc=(0,0)
              visible=(0,0,1080,2400) capture=(0,0,1080,2400) sigmaPx=131.25 density=2.625
D ParityBlur: [97458094] present bitmap=270x600 d=4 crop=(0,0,270,600) noBlur=false
              radiusPlatform=55.97 blurRadiusDp=50.0
```

Four things make this healthy, and each one is a question you can answer independently:

| Line | Answers |
|---|---|
| `blurRadius=50.0`, `props{...}` | **Are the props reaching native at all?** |
| `attached sdk=36 realBlurSupported=true` | **Is this device even capable of real blur?** (needs API 31+) |
| `plan ... capture=(...)` | **Is the geometry sane?** (non-empty, covers the view) |
| `present ... noBlur=false` | **Is it actually blurring?** |

## 3. Read your log against this table

### A. No `plan` / `present` lines at all → nothing is ever captured

Look for the reason, which is logged verbatim:

- `ineligible: view measured 0x0` — the view has no size. **Most common cause of "it does nothing".**
  Usually the *parent* collapsed, not the BlurView: a container whose children are **all** absolutely
  positioned has no in-flow content and resolves to height 0. See
  [BOTTOM_SHEET_BACKDROP.md](BOTTOM_SHEET_BACKDROP.md#1-give-the-backdrop-a-real-size). A warning is
  emitted automatically after 1.5s for this case, even with diagnostics off.
- `ineligible: capture target measured 0x0` / `capture target unresolved` — the view is not in a
  normal window hierarchy.
- `plan -> NULL: capture rect is empty` — the view is entirely **outside** the capture target.
- `live capture skipped: alpha=0.0` — the view (not an ancestor) is transparent.
- `live capture skipped: isShown=false` — the view or an ancestor is `INVISIBLE`/`GONE`.

### B. `present ... noBlur=true` (or `blurRadiusDp=0.0`) → captured fine, but not blurring

The backdrop is being presented **unblurred**, which looks exactly like pass-through. If you passed
a non-zero `blurRadius`, **the prop is not reaching native**. A warning is emitted automatically.

Check, in order:

1. Did codegen actually run for your React Native version? A **stale or failed codegen** leaves the
   generated `ViewManagerDelegate` missing, and then nothing sets props — clean and rebuild:
   `cd android && ./gradlew clean` then rebuild.
2. If you applied a `patch-package` patch to this library, confirm it applied **before** codegen ran.
   Gradle caches codegen output — a patch applied after a failed build may not re-trigger it.
3. Look for `Could not find generated setter for class com.parityblur.ParityBlurViewManager`. On a
   healthy Fabric build this warning is **benign** (the codegen delegate carries props). But if props
   are *also* missing from the `attached props{...}` line, it means the delegate is genuinely absent.

### C. `props{...}` shows defaults you didn't pass → props are being dropped

`blurRadius=0.0 mode=static` when you passed `blurRadius={50} mode="live"` is conclusive: the
JS→native prop bridge is broken for this component. Same checks as B.

### D. `realBlurSupported=false` → the device cannot do real blur

Android needs **API 31+** (`RenderEffect`). Below that the view paints `fallbackColor` and nothing
else — by design, see [LIMITATIONS.md](LIMITATIONS.md#android-below-api-31-no-real-blur).

> **`fallbackColor` not showing is NOT evidence of a bug.** On API 31+ it is deliberately never
> painted — the background is set to transparent. Its absence tells you nothing.

### E. No `ParityBlur` lines whatsoever → the native view was never created

Diagnostics are unconditional once the view attaches, so total silence means no `ParityBlurView` was
instantiated. That is an autolinking/codegen problem, not a blur problem. Check for a red
"Unimplemented component" box and confirm `com.parityblur.ParityBlurViewPackage` is in the APK.

### F. `plan` shows a `capture` much smaller than `visible` → clamped geometry

The capture is clamped to the target bounds, so a view lying partly outside the window only captures
a band. Since 0.1.2 the library defers the capture until the geometry settles and re-captures on
transform changes, so this should self-correct — if it does not, that is a bug worth reporting **with
this log**.

## 4. If you still need to file a report

Paste **all four** of these. Anything less and the first reply will just ask for them:

1. The `ParityBlur` log from §1 (the whole thing — the `props{...}` and `plan`/`present` lines are
   the ones that matter).
2. Your **exact** JSX for the BlurView **and its parent chain up to the screen root**, including
   every `style`. The parent matters at least as much as the BlurView.
3. `react-native` version, `react-native-parity-blur` version, New Arch on/off, device OS/API level.
4. Whether you patched this library (`patch-package` etc.) — and if so, the patch.

Useful extra: does it also fail with `mode="static"` and a plain, non-animated parent? That one
answer splits "our capture pipeline" from "your layout" immediately.
