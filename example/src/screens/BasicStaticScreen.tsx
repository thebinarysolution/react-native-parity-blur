import { StyleSheet, Text, View } from 'react-native';

/**
 * Milestone 1 stub -- static bottom-sheet-style demo screen (plan §32,
 * §42.2). Not implemented yet; there is no real blur until Milestone 3/4.
 */
export default function BasicStaticScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        BasicStaticScreen -- not yet implemented (Milestone 1 stub)
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
