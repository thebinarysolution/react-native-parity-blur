import { StyleSheet, Text, View } from 'react-native';

/**
 * Milestone 1 stub -- nested/overlapping BlurViews demo (plan §17, §32,
 * §42.2). Not implemented yet.
 */
export default function NestedBlurScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        NestedBlurScreen -- not yet implemented (Milestone 1 stub)
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
