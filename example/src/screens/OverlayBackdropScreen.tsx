import { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { BlurView, type BlurViewRef } from 'react-native-parity-blur';

const WIN = Dimensions.get('window');

/**
 * Repro harness for the "half blur behind a bottom sheet" report: a FULL-WINDOW transparent
 * BlurView backdrop mounted INSIDE a `translateY`-animated host (the @gorhom/bottom-sheet shape),
 * as opposed to BottomSheetScreen's "the BlurView IS the panel" pattern.
 *
 * The animation is replaced by a deterministic two-phase transform so the capture is GUARANTEED to
 * land while the host is translated -- an Animated/spring host reproduces this only as a race.
 *
 *   phase 'translated' (t=0)    host transform = translateY(TRANSLATED_Y); the backdrop's lower
 *                               half lies outside the window, so expandCaptureRect clamps the
 *                               capture to a BAND. This is the frame the static capture sees.
 *   phase 'settled'  (t=1.5s)   host transform = translateY(0); the backdrop is now exactly
 *                               fullscreen and every pixel of it is capturable.
 *
 * A correct static backdrop is fully blurred once settled. The bug freezes the band captured in
 * phase 1: `onSizeChanged` fires on SIZE only and `onLayout` on left/top only, but a transform is
 * a draw-time matrix that changes NEITHER -- so no recapture is ever triggered and the band is
 * permanent. Sharp show-through (rather than black) is expected wherever the presentation
 * RenderNode does not reach, because an uncovered region of a transparent overlay simply shows the
 * live content beneath it.
 *
 * Drive it with the FORCE_SCREEN switch in example/src/App.tsx ('overlay').
 */

/**
 * In DP. Chosen so the backdrop is PARTIALLY off-window at capture time (a band survives the
 * clamp), matching the reporter's screenshots. Note the trap: RN transforms are dp, so on the
 * Pixel 6a (density 2.75, 2400px tall) a translateY of ~873dp or more pushes the backdrop
 * ENTIRELY off-window -- expandCaptureRect then clamps to empty, computePlan returns null, and the
 * blur never captures at all, producing a fully-sharp screen instead of a band. Both outcomes are
 * the same bug; 300dp (= 825 device px) is the one that looks like the bug report.
 */
const TRANSLATED_Y = 300;
const SETTLE_MS = 1500;

/** Distinct, nameable rows so a screenshot says exactly which bands blurred and which did not. */
const ROWS = [
  { label: 'ROW 0', color: '#e53935' },
  { label: 'ROW 1', color: '#fb8c00' },
  { label: 'ROW 2', color: '#fdd835' },
  { label: 'ROW 3', color: '#43a047' },
  { label: 'ROW 4', color: '#00897b' },
  { label: 'ROW 5', color: '#1e88e5' },
  { label: 'ROW 6', color: '#8e24aa' },
  { label: 'ROW 7', color: '#d81b60' },
];

export default function OverlayBackdropScreen() {
  const blurRef = useRef<BlurViewRef>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <View style={styles.root}>
      {/* ---- the "dashboard" underneath: sharp text + saturated rows ---- */}
      <View style={styles.dashboard}>
        <Text style={styles.balanceLabel}>Total Balance</Text>
        <Text style={styles.balance}>$0.00</Text>
        {ROWS.map((row) => (
          <View
            key={row.label}
            style={[styles.row, { backgroundColor: row.color }]}
          >
            <Text style={styles.rowText}>
              {row.label} -- the quick brown fox jumps over 0123456789
            </Text>
          </View>
        ))}
      </View>

      {/* ---- the overlay host: transform-animated, exactly like a sheet container ----
           Sized EXPLICITLY rather than via absoluteFillObject: this host's children are all
           absolutely positioned, so an in-flow host collapses to height 0 and drags the backdrop
           with it, which masks the effect under test. */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: WIN.width,
          height: WIN.height,
          transform: [{ translateY: settled ? 0 : TRANSLATED_Y }],
        }}
        pointerEvents="box-none"
      >
        <BlurView
          ref={blurRef}
          mode="static"
          blurRadius={20}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: WIN.width,
            height: WIN.height,
          }}
        />

        {/* opaque sheet on top of the backdrop, like the reporter's */}
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Select wallet</Text>
          <Text style={styles.sheetPhase}>
            phase:{' '}
            {settled
              ? 'SETTLED (translateY 0)'
              : `TRANSLATED (translateY ${TRANSLATED_Y})`}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  dashboard: { flex: 1, paddingTop: 60 },
  balanceLabel: {
    color: '#9e9e9e',
    fontSize: 20,
    textAlign: 'center',
  },
  balance: {
    color: '#fff',
    fontSize: 56,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 24,
  },
  row: { paddingVertical: 18, paddingHorizontal: 12 },
  rowText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 320,
    backgroundColor: '#111',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
  },
  sheetTitle: { color: '#fff', fontSize: 26, fontWeight: 'bold' },
  sheetPhase: { color: '#4dd0e1', fontSize: 14, marginTop: 10 },
});
