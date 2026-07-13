import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'react-native-parity-blur';

/**
 * Milestone 5 calibration screen (plan §38).
 *
 * One deterministic fixture image stretched full-screen with five blur strips at the plan's
 * fixed radii (4, 8, 16, 24, 32 dp). The fixture is selected by the module constant below —
 * the calibration harness edits it and POSTs /reload to Metro, which updates every connected
 * device simultaneously; screenshots are then compared cross-platform (side-by-side, pixel
 * difference, SSIM — plan §38/§42.1).
 *
 * Layout is entirely in dp so both platforms show identical logical content. Strips leave
 * fixture gaps between them so unblurred reference pixels are always available to the analysis.
 */

// Edited by the calibration harness: bw | rg | by | checkerboard | photo | alpha
export const FIXTURE: string = 'photo';
// Tinted pass: exercises overlay+saturation parity on top of the same fixtures.
export const TINTED: boolean = false;

const SOURCES: Record<string, ReturnType<typeof require>> = {
  bw: require('../assets/calibration/bw-gradient.png'),
  rg: require('../assets/calibration/rg-gradient.png'),
  by: require('../assets/calibration/by-gradient.png'),
  checkerboard: require('../assets/calibration/checkerboard.png'),
  photo: require('../assets/calibration/photo.png'),
  alpha: require('../assets/calibration/alpha-edge.png'),
};

const RADII = [4, 8, 16, 24, 32] as const;
const STRIP_HEIGHT = 96;
const STRIP_GAP = 40;
const STRIPS_TOP = 120;

export default function CalibrationScreen() {
  // Blur strips mount only after the fixture image is decoded and committed: static capture
  // runs once at mount, so capturing before the backdrop exists would blur an empty frame
  // (both platforms decode images asynchronously). The 250ms settle covers the commit.
  const [ready, setReady] = useState(false);

  return (
    <View style={styles.root} testID="calibration-root">
      <Image
        key={FIXTURE}
        source={SOURCES[FIXTURE] ?? SOURCES.photo}
        style={StyleSheet.absoluteFill}
        resizeMode="stretch"
        fadeDuration={0}
        onLoad={() => setTimeout(() => setReady(true), 250)}
      />
      {ready &&
        RADII.map((radius, i) => (
          <BlurView
            key={`${FIXTURE}-${TINTED}-${radius}`}
            style={[
              styles.strip,
              { top: STRIPS_TOP + i * (STRIP_HEIGHT + STRIP_GAP) },
            ]}
            blurRadius={radius}
            mode="static"
            overlayColor={TINTED ? 'rgba(16,16,16,0.35)' : 'transparent'}
            saturation={TINTED ? 1.4 : 1}
            quality="balanced"
            downsample="auto"
          >
            <Text
              style={styles.label}
            >{`σ=${radius}dp${TINTED ? ' tinted' : ''}`}</Text>
          </BlurView>
        ))}
      <Text
        style={styles.fixtureTag}
      >{`fixture:${FIXTURE}${TINTED ? ':tinted' : ''}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: STRIP_HEIGHT,
    justifyContent: 'center',
  },
  label: {
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 8,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 2,
  },
  fixtureTag: {
    position: 'absolute',
    bottom: 24,
    left: 12,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 3,
  },
});
