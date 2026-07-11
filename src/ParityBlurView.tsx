import type { ColorValue, ViewProps } from 'react-native';

type Props = ViewProps & {
  color?: ColorValue;
};

export function ParityBlurView(_props: Props): never {
  throw new Error(
    "'react-native-parity-blur' is only supported on native platforms."
  );
}
