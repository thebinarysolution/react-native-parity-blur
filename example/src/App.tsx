import { useRef, useState } from 'react';
import {
  Button,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { BlurView, type BlurViewRef } from 'react-native-parity-blur';
import BottomSheetScreen from './screens/BottomSheetScreen';
import CalibrationScreen from './screens/CalibrationScreen';
import LiveHeaderScreen from './screens/LiveHeaderScreen';
import LifecycleScreen from './screens/LifecycleScreen';
import MultiBlurScreen from './screens/MultiBlurScreen';
import OverlayBackdropScreen from './screens/OverlayBackdropScreen';

/**
 * Harness override: when non-null, the app renders ONE fixed screen with no chrome, so
 * cross-platform screenshots are pixel-comparable. The device harness edits this constant and
 * POSTs /reload to Metro (updates all connected devices at once).
 */
const FORCE_SCREEN:
  'calibration' | 'live' | 'lifecycle' | 'multi' | 'overlay' | null = null;

/**
 * Example app root.
 *
 * No navigation library is used (plan §32 keeps the example minimal): a single button toggles
 * between the original Milestone-1-era props smoke test below and the Milestone 3 bottom-sheet
 * demo (example/src/screens/BottomSheetScreen.tsx), which exercises the real Android static
 * blur backend end-to-end.
 */
export default function App() {
  const [showBottomSheetDemo, setShowBottomSheetDemo] = useState(true);

  if (FORCE_SCREEN === 'calibration') {
    return <CalibrationScreen />;
  }
  if (FORCE_SCREEN === 'live') {
    return <LiveHeaderScreen />;
  }
  if (FORCE_SCREEN === 'lifecycle') {
    return <LifecycleScreen />;
  }
  if (FORCE_SCREEN === 'multi') {
    return <MultiBlurScreen />;
  }
  if (FORCE_SCREEN === 'overlay') {
    return <OverlayBackdropScreen />;
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.screenToggle}>
        <Button
          title={
            showBottomSheetDemo
              ? 'Show props smoke test'
              : 'Show bottom sheet demo'
          }
          onPress={() => setShowBottomSheetDemo((v) => !v)}
        />
      </View>
      {showBottomSheetDemo ? <BottomSheetScreen /> : <PropsSmokeTestScreen />}
    </View>
  );
}

/**
 * Milestone 1 (scaffold) props smoke test, kept as a secondary screen.
 *
 * Exercises every public prop from plan §28 and the `refresh()` imperative
 * command from plan §29.
 */
function PropsSmokeTestScreen() {
  const blurRef = useRef<BlurViewRef>(null);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>react-native-parity-blur</Text>
      <Text style={styles.subheading}>Props smoke test</Text>

      <View style={styles.backdrop}>
        <View style={styles.swatchRed} />
        <View style={styles.swatchBlue} />
        <View style={styles.swatchYellow} />

        <BlurView
          ref={blurRef}
          style={styles.blur as ViewStyle}
          blurRadius={16}
          mode="static"
          overlayColor="rgba(16,16,16,0.35)"
          saturation={1}
          quality="balanced"
          downsample="auto"
          maxFps={30}
          fallbackColor="rgba(12,12,12,0.9)"
        >
          <Text style={styles.blurChildText}>Children stay sharp</Text>
        </BlurView>
      </View>

      <Button title="refresh()" onPress={() => blurRef.current?.refresh()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenToggle: {
    position: 'absolute',
    top: 44,
    right: 8,
    zIndex: 10,
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
  },
  subheading: {
    fontSize: 13,
    opacity: 0.6,
    marginBottom: 8,
  },
  backdrop: {
    width: 280,
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
  },
  swatchRed: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '60%',
    height: '60%',
    backgroundColor: '#e5484d',
  },
  swatchBlue: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: '50%',
    height: '50%',
    backgroundColor: '#0090ff',
  },
  swatchYellow: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: '55%',
    height: '65%',
    backgroundColor: '#ffe629',
  },
  blur: {
    position: 'absolute',
    top: 40,
    left: 30,
    right: 30,
    bottom: 40,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blurChildText: {
    color: 'white',
    fontWeight: '600',
  },
});
