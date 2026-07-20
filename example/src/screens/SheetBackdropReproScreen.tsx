import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'react-native-parity-blur';

/**
 * Faithful reproduction of the user-reported "blurred sheet backdrop is pure passthrough" layout
 * (PARITY_BLUR_REPRO_FOR_AUTHOR.md), transcribed to RN's own Animated so the example needs no
 * Reanimated dependency. Every structural property the report calls out is preserved:
 *
 *   - live scrollable content underneath (same window, NOT a native <Modal>),
 *   - a full-screen BlurView backdrop that is a SIBLING below the panel,
 *   - the backdrop wrapped in an OPACITY-ANIMATED parent that starts at 0 and fades to 1,
 *   - an opaque panel translating up from the bottom,
 *   - mode="live", blurRadius=50, overlayColor rgba(0,0,0,0.08).
 *
 * The reporter's Q3 is the interesting variable: does an opacity-animated ancestor break the
 * Android capture pipeline? (The library they compared against required the blur NOT to be inside
 * an opacity animation.) BACKDROP_OPACITY_ANIMATED flips that one factor while holding the rest
 * fixed, so the two runs isolate it.
 *
 * Drive with FORCE_SCREEN='sheetrepro' in example/src/App.tsx.
 */

/** Set false to mount the backdrop at a constant opacity 1 (the controlled comparison). */
const BACKDROP_OPACITY_ANIMATED = true;

/** 'live' matches the report; 'static' is the reporter's "also tried" case. */
const BLUR_MODE: 'live' | 'static' = 'live';

/**
 * Android-only Z gotcha under test. `elevation` reorders siblings by Z INDEPENDENTLY of `zIndex`:
 * ViewGroup sorts children by Z whenever any child has Z != 0, so content with elevation draws
 * ABOVE a backdrop that has none — no matter what the tree order or zIndex says. A real dashboard
 * (cards, FABs, app bars) is full of elevated views.
 *
 * TESTED on a Pixel 6a and it does NOT reproduce the report, for a reason worth recording: Z only
 * reorders SIBLINGS WITHIN ONE PARENT. These cards live inside the ScrollView while the backdrop
 * lives inside the sheet overlay — different parents — so no elevation on a card can lift it above
 * the backdrop. For elevation to break a backdrop, the elevated view must be a sibling of the
 * backdrop's own ancestor at the same level (e.g. elevation on the content ROOT itself). Kept as a
 * knob because that variant is still worth testing against a real app's tree.
 */
const CONTENT_ELEVATION = 0;

export default function SheetBackdropReproScreen() {
  const [open, setOpen] = useState(false);

  // Auto-open so the harness needs no tap tooling.
  useEffect(() => {
    const id = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(id);
  }, []);

  return (
    <View style={StyleSheet.absoluteFill}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {Array.from({ length: 40 }).map((_, i) => (
          <View key={i} style={[styles.card, { elevation: CONTENT_ELEVATION }]}>
            <Text
              style={[styles.row, { color: ROW_COLORS[i % ROW_COLORS.length] }]}
            >
              Row {i} — content behind the sheet
            </Text>
            {/* An <Image> every few rows: the reporter's app is image-heavy, and live mode
                captures via a software Canvas, which is exactly where the (still unproven)
                HARDWARE-bitmap gap would bite. Text alone cannot expose it. */}
            {i % 5 === 0 ? (
              <Image
                source={require('../assets/calibration/photo.png')}
                style={styles.photo}
                resizeMode="cover"
              />
            ) : null}
          </View>
        ))}
      </ScrollView>

      <Pressable style={styles.fab} onPress={() => setOpen(true)}>
        <Text style={styles.fabText}>Open sheet</Text>
      </Pressable>

      {open ? <SheetOverlay onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

function SheetOverlay({ onClose }: { onClose: () => void }) {
  const { height } = useWindowDimensions();
  const panelHeight = height * 0.5;

  const translateY = useRef(new Animated.Value(panelHeight)).current;
  const backdropOpacity = useRef(
    new Animated.Value(BACKDROP_OPACITY_ANIMATED ? 0 : 1)
  ).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [translateY, backdropOpacity]);

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* backdrop: z 1, below the panel, full screen, inside an opacity-animated parent */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.backdrop,
          { opacity: backdropOpacity },
        ]}
      >
        <BlurView
          style={StyleSheet.absoluteFill}
          blurRadius={50}
          mode={BLUR_MODE}
          maxFps={30}
          overlayColor="rgba(0,0,0,0.08)"
          fallbackColor="rgba(137,137,137,0.30)"
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* panel: z 2, opaque, slides up */}
      <Animated.View
        style={[
          styles.panel,
          { height: panelHeight, transform: [{ translateY }] },
        ]}
      >
        <Text style={styles.panelText}>Sheet content</Text>
        <Text style={styles.panelMeta}>
          mode={BLUR_MODE} · opacityAnimatedParent=
          {String(BACKDROP_OPACITY_ANIMATED)}
        </Text>
      </Animated.View>
    </View>
  );
}

const ROW_COLORS = [
  '#e53935',
  '#fb8c00',
  '#fdd835',
  '#43a047',
  '#1e88e5',
  '#8e24aa',
];

const styles = StyleSheet.create({
  scroll: { padding: 24 },
  card: {
    backgroundColor: 'white',
    borderRadius: 8,
    marginVertical: 6,
    padding: 8,
  },
  photo: { width: '100%', height: 160, marginVertical: 8, borderRadius: 8 },
  row: { fontSize: 22, marginVertical: 10, fontWeight: '700' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 40,
    backgroundColor: '#333',
    padding: 16,
    borderRadius: 12,
  },
  fabText: { color: 'white' },
  backdrop: { zIndex: 1 },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    zIndex: 2,
    elevation: 2,
    backgroundColor: 'white',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  panelText: { fontSize: 18, padding: 20 },
  panelMeta: { fontSize: 13, paddingHorizontal: 20, color: '#666' },
});
