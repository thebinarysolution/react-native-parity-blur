import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'react-native-parity-blur';

/**
 * Milestone 6 live-mode demo (plan §21, §39, §42.2): a live blurred header pinned over
 * scrolling content. An auto-scroll drives continuous backdrop motion so the live coordinator
 * can be observed without touch input (the harness screenshots at intervals; motion under the
 * header must track, unlike static mode which stays frozen until refresh()).
 */

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

export default function LiveHeaderScreen() {
  // RN 0.85 strict-api has no stable public ScrollView instance type (ComponentRef resolves
  // to never); untyped ref is fine for this demo's scrollTo-only use.
  const scrollRef = useRef<any>(null);

  useEffect(() => {
    let y = 0;
    let dir = 1;
    const id = setInterval(() => {
      y += 6 * dir;
      if (y > 1400) dir = -1;
      if (y < 0) dir = 1;
      scrollRef.current?.scrollTo({ y, animated: false });
    }, 33);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={styles.root}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        {BAND_COLORS.map((color, i) => (
          <View key={i} style={[styles.band, { backgroundColor: color }]}>
            <Text style={styles.bandText}>
              Band {i} -- the quick brown fox jumps over 0123456789
            </Text>
          </View>
        ))}
      </ScrollView>

      <BlurView
        style={styles.header}
        blurRadius={16}
        mode="live"
        maxFps={30}
        quality="balanced"
        downsample="auto"
      >
        <Text style={styles.headerTitle}>Live blurred header</Text>
        <Text style={styles.headerSubtitle}>
          mode="live" -- content scrolls beneath
        </Text>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  content: { paddingTop: 130, paddingBottom: 200 },
  band: { height: 160, justifyContent: 'flex-end', padding: 16 },
  bandText: { color: 'black', fontWeight: '700', fontSize: 15 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 110,
    justifyContent: 'flex-end',
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  headerTitle: { color: 'white', fontSize: 17, fontWeight: '700' },
  headerSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
});
