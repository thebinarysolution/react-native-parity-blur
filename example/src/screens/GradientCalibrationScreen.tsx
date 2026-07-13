import { StyleSheet, Text, View } from 'react-native';

/**
 * Milestone 1 stub -- gradient/color-pipeline calibration fixtures (plan
 * §9, §38). Not implemented yet; calibration is Milestone 5.
 */
export default function GradientCalibrationScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        GradientCalibrationScreen -- not yet implemented (Milestone 1 stub)
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
