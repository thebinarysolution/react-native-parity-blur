import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { BlurView } from 'react-native-parity-blur';

/**
 * Milestone 7 stress screen (plan §40 "many simultaneous views" / "offscreen views"): 12 static
 * BlurViews tiled down a scrolling colorful backdrop plus 2 live BlurViews pinned as header and
 * footer chrome. Scrolling carries most of the static tiles off-screen while the pinned live
 * views keep ticking -- exercises WindowBlurContext with a realistic view count and the
 * visibility heuristic (plan §24) for the live pair without any of it requiring touch precision.
 */

const TILE_COLORS = [
  '#e53935',
  '#fb8c00',
  '#fdd835',
  '#43a047',
  '#00897b',
  '#1e88e5',
  '#8e24aa',
  '#d81b60',
  '#6d4c41',
  '#00bcd4',
  '#3949ab',
  '#c2185b',
];

export default function MultiBlurScreen() {
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        {TILE_COLORS.map((color, i) => (
          <View key={i} style={[styles.row, { backgroundColor: color }]}>
            <BlurView
              style={styles.tile}
              blurRadius={14}
              mode="static"
              overlayColor="rgba(0,0,0,0.18)"
            >
              <Text style={styles.tileText}>static #{i}</Text>
            </BlurView>
          </View>
        ))}
      </ScrollView>

      <BlurView style={styles.header} blurRadius={16} mode="live" maxFps={30}>
        <Text style={styles.chromeText}>live header</Text>
      </BlurView>
      <BlurView style={styles.footer} blurRadius={16} mode="live" maxFps={30}>
        <Text style={styles.chromeText}>live footer -- 12 static + 2 live</Text>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  content: { paddingTop: 110, paddingBottom: 90 },
  row: { height: 140, alignItems: 'center', justifyContent: 'center' },
  tile: {
    width: '70%',
    height: 90,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: { color: 'white', fontWeight: '700' },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 100,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 12,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chromeText: { color: 'white', fontWeight: '700', fontSize: 13 },
});
