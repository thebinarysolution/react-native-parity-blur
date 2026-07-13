import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView, type BlurViewRef } from 'react-native-parity-blur';

/**
 * Static bottom-sheet demo (plan §32, §42.2, Milestone 3).
 *
 * Full-screen colorful scrolling content sits behind a bottom-sheet panel whose backdrop is a
 * real ParityBlurView (API 31+: software capture -> RenderEffect blur+saturation, API<31:
 * fallbackColor). Two prop variants are selectable from the same sheet instance:
 *   - "clear": blurRadius only, no overlay, saturation neutral (default).
 *   - "tinted": overlayColor='rgba(16,16,16,0.35)', saturation=1.4.
 *
 * Buttons exercise refresh() (plan §29) and the recapture-requiring blurRadius prop (plan §20)
 * by cycling 4 -> 16 -> 32 dp. The sheet's top corners use borderRadius to exercise the
 * Milestone 3 rounded-clipping wiring (plan §31).
 */

const RADII = [4, 16, 32] as const;

const BAND_COLORS = [
  '#e53935',
  '#fb8c00',
  '#fdd835',
  '#43a047',
  '#00897b',
  '#1e88e5',
  '#8e24aa',
  '#d81b60',
  '#6d4c41',
  '#ff00ff',
  '#00bcd4',
  '#3949ab',
];

export default function BottomSheetScreen() {
  const blurRef = useRef<BlurViewRef>(null);
  const [radiusIndex, setRadiusIndex] = useState(1); // start at 16dp
  const [tinted, setTinted] = useState(false);

  const blurRadius = RADII[radiusIndex];

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.heading}>react-native-parity-blur</Text>
        <Text style={styles.subheading}>
          Static bottom sheet -- Milestone 3 (Android real blur)
        </Text>
        {BAND_COLORS.map((color, i) => (
          <View key={i} style={[styles.band, { backgroundColor: color }]}>
            <Text style={styles.bandText}>
              Band {i} -- the quick brown fox jumps over 0123456789
            </Text>
          </View>
        ))}
      </ScrollView>

      <BlurView
        ref={blurRef}
        style={styles.sheet}
        blurRadius={blurRadius}
        mode="static"
        overlayColor={tinted ? 'rgba(16,16,16,0.35)' : 'transparent'}
        saturation={tinted ? 1.4 : 1}
        quality="balanced"
        downsample="auto"
        fallbackColor="rgba(20,20,20,0.92)"
      >
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>Bottom sheet</Text>
        <Text style={styles.sheetSubtitle}>
          radius {blurRadius}dp -- {tinted ? 'tinted' : 'clear'} variant
        </Text>

        <View style={styles.buttonRow}>
          <Pressable
            style={styles.button}
            onPress={() => blurRef.current?.refresh()}
          >
            <Text style={styles.buttonText}>refresh()</Text>
          </Pressable>
          <Pressable
            style={styles.button}
            onPress={() => setRadiusIndex((i) => (i + 1) % RADII.length)}
          >
            <Text style={styles.buttonText}>radius: {blurRadius}</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => setTinted((t) => !t)}>
            <Text style={styles.buttonText}>
              variant: {tinted ? 'tinted' : 'clear'}
            </Text>
          </Pressable>
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  scrollContent: {
    paddingBottom: 320,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: 'white',
    padding: 16,
  },
  subheading: {
    fontSize: 13,
    color: 'white',
    opacity: 0.7,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  band: {
    height: 160,
    justifyContent: 'flex-end',
    padding: 16,
  },
  bandText: {
    color: 'black',
    fontWeight: '700',
    fontSize: 15,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 280,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    alignItems: 'center',
    paddingTop: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.6)',
    marginBottom: 12,
  },
  sheetTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '700',
  },
  sheetSubtitle: {
    color: 'white',
    opacity: 0.8,
    fontSize: 13,
    marginTop: 4,
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
  },
  button: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 13,
  },
});
