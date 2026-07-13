import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView, type BlurViewRef } from 'react-native-parity-blur';

/**
 * Milestone 7 lifecycle test-matrix driver (plan §40).
 *
 * Everything that can be driven from JS lives on one screen so the harness can exercise most
 * matrix rows with taps instead of a Metro reload per scenario (reload is rate-limited and
 * disruptive -- see scripts/devices.sh "hard-won rules"). Rows this screen drives:
 *   - attach/detach (Mount/Unmount button -- conditional render, real unmount/mount)
 *   - rapid remount loop (10x button -- ~250ms cadence, real unmount+mount each cycle)
 *   - mode toggling static<->live (mode button)
 *   - static+live coexistence (bottom section, always both mounted)
 *   - offscreen views (scroll the page; the coexistence section starts below the fold)
 *   - refresh() (imperative command)
 *
 * Rows this screen CANNOT drive from JS (native/OS-level, exercised by the harness directly):
 *   background/foreground (adb keyevent HOME + relaunch / devicectl relaunch), rotation (device
 *   rotation while this screen is active), memory pressure (adb shell dumpsys / Xcode simulate
 *   memory warning). Native lifecycle correctness (scheduler pause/resume, listener/texture
 *   release) is verified out-of-band via logcat / `log stream` while these controls are used --
 *   see docs/HARDENING_REPORT.md for captured evidence.
 */

const BAND_COLORS = [
  '#e53935',
  '#fb8c00',
  '#fdd835',
  '#43a047',
  '#00897b',
  '#1e88e5',
];

export default function LifecycleScreen() {
  const [mounted, setMounted] = useState(true);
  const [mode, setMode] = useState<'static' | 'live'>('static');
  const [remounting, setRemounting] = useState(false);
  const [remountCount, setRemountCount] = useState(0);
  const blurRef = useRef<BlurViewRef>(null);

  // Rapid remount x10 (plan §40): flips mount state 10 times ~250ms apart. Each flip destroys
  // the current native instance and creates a fresh one (conditional render, not a persistent
  // element with a changing key) -- back-to-back onAttachedToWindow/onDetachedFromWindow
  // (Android) and didMoveToWindow(nil->window) (iOS) cycles.
  useEffect(() => {
    if (!remounting) return;
    let cancelled = false;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      if (cancelled) return;
      if (i >= 10) {
        setRemounting(false);
        return;
      }
      setMounted((m) => !m);
      i += 1;
      setRemountCount(i);
      timer = setTimeout(step, 250);
    };
    timer = setTimeout(step, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [remounting]);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>Lifecycle matrix</Text>
        <Text style={styles.status}>
          mounted={String(mounted)} · mode={mode} · remount cycles=
          {remountCount}
          {remounting ? ' · remounting…' : ''}
        </Text>

        <View style={styles.buttonRow}>
          <Pressable
            style={styles.button}
            onPress={() => setMounted((m) => !m)}
          >
            <Text style={styles.buttonText}>
              {mounted ? 'Unmount' : 'Mount'}
            </Text>
          </Pressable>
          <Pressable
            style={styles.button}
            onPress={() => setMode((m) => (m === 'static' ? 'live' : 'static'))}
          >
            <Text style={styles.buttonText}>mode: {mode}</Text>
          </Pressable>
          <Pressable
            style={styles.button}
            disabled={remounting}
            onPress={() => {
              setRemountCount(0);
              setRemounting(true);
            }}
          >
            <Text style={styles.buttonText}>
              {remounting ? 'remounting…' : 'Rapid remount x10'}
            </Text>
          </Pressable>
          <Pressable
            style={styles.button}
            onPress={() => blurRef.current?.refresh()}
          >
            <Text style={styles.buttonText}>refresh()</Text>
          </Pressable>
        </View>

        <View style={styles.backdrop}>
          {BAND_COLORS.map((c, i) => (
            <View key={i} style={[styles.band, { backgroundColor: c }]} />
          ))}
          {mounted && (
            <BlurView
              ref={blurRef}
              style={styles.blur}
              blurRadius={16}
              mode={mode}
              maxFps={30}
              overlayColor="rgba(16,16,16,0.25)"
            >
              <Text style={styles.blurText}>mode={mode}</Text>
            </BlurView>
          )}
        </View>

        <Text style={styles.heading}>
          Static + live coexistence (scroll to reveal)
        </Text>
        <Text style={styles.status}>
          Also exercises "offscreen views": this section starts below the fold.
        </Text>
        <View style={styles.spacer} />
        <View style={styles.backdrop}>
          {BAND_COLORS.map((c, i) => (
            <View key={`b${i}`} style={[styles.band, { backgroundColor: c }]} />
          ))}
          <BlurView
            style={[styles.blur, styles.coexistLeft]}
            blurRadius={12}
            mode="static"
          >
            <Text style={styles.blurText}>static</Text>
          </BlurView>
          <BlurView
            style={[styles.blur, styles.coexistRight]}
            blurRadius={12}
            mode="live"
            maxFps={30}
          >
            <Text style={styles.blurText}>live</Text>
          </BlurView>
        </View>
        <View style={styles.spacer} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111' },
  scroll: { padding: 16, paddingBottom: 80, gap: 12 },
  heading: { fontSize: 17, fontWeight: '700', color: 'white', marginTop: 8 },
  status: { fontSize: 12, color: 'rgba(255,255,255,0.75)' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 12 },
  backdrop: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
  },
  band: { flex: 1 },
  blur: {
    position: 'absolute',
    top: 30,
    left: 20,
    right: 20,
    bottom: 30,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coexistLeft: { right: '52%' },
  coexistRight: { left: '52%' },
  blurText: { color: 'white', fontWeight: '700' },
  spacer: { height: 400 },
});
