# Full-window backdrop behind a bottom sheet or modal

There are two different ways to use a `BlurView` with a sheet, and they are not variations of one
pattern — they are different layouts with different rules.

| | **Panel** | **Backdrop** |
|---|---|---|
| What is blurred | the sheet's own surface | the whole screen behind the sheet |
| The `BlurView` is | the sheet panel itself, with your content as its children | a transparent full-window overlay, with the sheet as a **sibling on top** |
| Sizing | anchored to the bottom, explicit height | full window |
| Covered in | the [README Quick Start](../README.md#quick-start) | this page |

This page is the **backdrop**: a blurred full-window layer that sits *above* your screen content and
*below* an opaque sheet.

```
┌─────────────────────────┐
│  your screen content    │  ← sharp, untouched
├─────────────────────────┤
│  BlurView (backdrop)    │  ← transparent overlay, full window, blurs everything above
├─────────────────────────┤
│  your sheet             │  ← opaque, sharp, drawn on top
└─────────────────────────┘
```

## The shape

The `BlurView` and the sheet are **siblings**. The blur is not a parent of the sheet, and the sheet
is not a child of the blur:

```jsx
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'react-native-parity-blur';

function Screen() {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      <Dashboard onOpen={() => setSheetOpen(true)} />

      {sheetOpen && (
        <>
          {/* backdrop: transparent, full window, BEHIND the sheet */}
          <BlurView
            style={StyleSheet.absoluteFillObject}
            blurRadius={20}
            mode="static"
            overlayColor="rgba(16,16,16,0.35)"
            fallbackColor="rgba(20,20,20,0.92)"
          />

          {/* sheet: opaque, sharp, ON TOP of the backdrop */}
          <MySheet onClose={() => setSheetOpen(false)} />
        </>
      )}
    </View>
  );
}
```

`mode="static"` is right here: the backdrop is captured once, costs nothing per frame afterwards,
and a dashboard behind a modal sheet is not usually animating. See
[Static vs live](#static-vs-live) below.

## With `@gorhom/bottom-sheet`

Render the blur inside a custom `backdropComponent`. gorhom's backdrop container is **not**
transform-animated (only the sheet content is), so animating its **opacity** is both the idiomatic
and the correct thing to do:

```jsx
import BottomSheet, { type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { StyleSheet } from 'react-native';
import { BlurView } from 'react-native-parity-blur';

function BlurBackdrop({ animatedIndex, style }: BottomSheetBackdropProps) {
  const fade = useAnimatedStyle(() => ({
    opacity: interpolate(animatedIndex.value, [-1, 0], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View style={[style, fade]} pointerEvents="none">
      <BlurView style={StyleSheet.absoluteFillObject} blurRadius={20} mode="static" />
    </Animated.View>
  );
}

// ...
<BottomSheet snapPoints={['50%']} backdropComponent={BlurBackdrop}>
  {/* sheet content */}
</BottomSheet>
```

Fade the backdrop with **opacity**, not with a transform. Opacity does not move the view, so the
capture geometry never changes and the blur is captured exactly once.

## Pitfalls

### 1. Give the backdrop a real size

A `BlurView` is laid out like any other view. A zero-height backdrop captures nothing and renders
nothing — you get a completely sharp screen and no error.

The usual cause is the **parent**, not the blur: a container whose children are *all* absolutely
positioned has no in-flow content, so it collapses to height 0 and takes the backdrop down with it.

```jsx
// ✗ host has no in-flow children -> collapses to height 0 -> backdrop is 1080x0
<View style={StyleSheet.absoluteFillObject}>   // ...if this itself lands in flow
  <BlurView style={StyleSheet.absoluteFillObject} />
</View>

// ✓ explicit, unambiguous
const win = Dimensions.get('window');
<View style={{ position: 'absolute', top: 0, left: 0, width: win.width, height: win.height }}>
  <BlurView style={{ position: 'absolute', top: 0, left: 0, width: win.width, height: win.height }} />
</View>
```

If a backdrop renders nothing, check its measured height first — `onLayout={e => console.log(e.nativeEvent.layout)}` on both the blur and its parent.

### 2. Your sheet is not excluded from the capture

The capture excludes ParityBlur's own surfaces (so a blur never blurs itself), but it does **not**
know about your sheet. A sheet already on screen when the capture happens gets blurred *into* the
backdrop — typically visible as a smeared ghost of the sheet's own chrome inside the blur.

With `mode="static"` the capture happens at mount/layout, which normally precedes the sheet
appearing, so this is usually free. If you call `refresh()` yourself, guard it:

```jsx
if (!sheetOpen) blurRef.current?.refresh();
```

Note `refresh()` coalesces to the next frame and has no completion callback, so
`refresh(); setSheetOpen(true)` in the same tick is a race that can bake the sheet in.

### 3. React Native's core `<Modal>` is a separate window

A core `<Modal>` renders into its own native window (a `Dialog` on Android, a `UIWindow` on iOS). A
`BlurView` inside it cannot capture your app's content, because that content is in a *different*
window — you get a fully transparent blur and a sharp screen. No layout change fixes this; it is a
[documented limitation](LIMITATIONS.md#cross-window--modal-capture).

Use an in-window host instead: an absolute sibling at the screen root, a `@gorhom/bottom-sheet`
backdrop, or react-native-screens `transparentModal`.

### 4. Transform-animated hosts are handled — but prefer opacity

If your backdrop *is* inside a transform-animated container (a `translateY` sheet host, a
`transparentModal` transition), the library handles it: it watches the view's window position and
captures once the transform settles, so a partially-off-window frame mid-animation is never frozen.

You still get a cheaper, more predictable result by keeping the backdrop out of the animated
container and fading its opacity instead — that path captures once and never re-captures.

## Static vs live

- **`mode="static"` (default)** — capture once. Right for a modal backdrop over a dashboard that
  isn't moving. Zero per-frame cost. If the content behind changes while the sheet is open, call
  `refresh()` (see pitfall 2 about guarding it).
- **`mode="live"`** — recapture continuously, throttled by `maxFps`. Only worth it if the content
  behind the backdrop is genuinely animating while the sheet is open. See
  [PERFORMANCE.md](PERFORMANCE.md).

## Android < 31

There is no real blur below API 31 (see [LIMITATIONS.md](LIMITATIONS.md#android-below-api-31-no-real-blur)).
Always pass a `fallbackColor` on a backdrop — it is what those users will see instead, and a
backdrop with no fallback is fully transparent there, leaving your sheet floating over sharp
content:

```jsx
<BlurView style={StyleSheet.absoluteFillObject} blurRadius={20}
          fallbackColor="rgba(20,20,20,0.92)" />
```
