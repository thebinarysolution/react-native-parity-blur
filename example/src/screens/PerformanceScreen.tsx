import { StyleSheet, Text, View } from 'react-native';

/**
 * Milestone 1 stub -- performance measurement demo (plan §42.3). Not
 * implemented yet.
 */
export default function PerformanceScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        PerformanceScreen -- not yet implemented (Milestone 1 stub)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  text: { textAlign: 'center' },
});
