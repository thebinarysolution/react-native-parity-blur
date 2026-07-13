/**
 * Fabric codegen spec for the ParityBlurView native host view.
 *
 * Every public prop from plan §28 is plumbed through to native, and the
 * `refresh()` Fabric command is wired end-to-end to a real coalesced
 * recapture. Both native backends (Android Kotlin, iOS Swift) implement the
 * real capture/blur/saturate/overlay pipeline defined in
 * docs/PIPELINE_SPEC.md — this file only declares the codegen shape, not
 * the behavior.
 *
 * Deviation from plan §28 (documented in the Milestone 1 report): the public
 * `downsample` prop is `'auto' | 1 | 2 | 4 | 8` (see src/types.ts). Fabric
 * codegen's TypeScript parser rejects a union that mixes string and numeric
 * literals for one prop ("Mixed types are not supported"), and a plain
 * string enum with numeric-looking values ('1', '2', ...) is also unsafe
 * because the iOS/C++ generator turns each enum option into a bare
 * identifier (`ParityBlurViewDownsample::1` is not valid C++). Instead this
 * native prop is a plain Int32 where `0` is a sentinel for `'auto'` and
 * `1 | 2 | 4 | 8` pass through unchanged. `src/BlurView.tsx` performs the
 * 'auto' <-> 0 translation; native code treats 0 as "auto".
 *
 * Note: this file deliberately imports everything from the 'react-native'
 * package root rather than deep 'react-native/Libraries/...' paths. This
 * project's tsconfig opts into the `react-native-strict-api` custom
 * condition, and react-native's package.json `exports` map explicitly
 * blocks deep `Libraries/*` subpath imports under that condition -- so
 * `codegenNativeCommands`, `codegenNativeComponent`, and the CodegenTypes
 * (Double/Int32/WithDefault) must come from the root barrel, which
 * re-exports all three for exactly this reason.
 *
 * Also note: do NOT re-export `CodegenTypes.WithDefault`/`Double`/`Int32` as
 * local generic type aliases (an earlier draft of this file did, to shorten
 * the qualified names). @react-native/codegen's alias resolution does plain
 * textual substitution with no generic instantiation, so a chain like
 * `NativeBlurMode -> WithDefault<'static'|'live','static'> -> (local
 * `WithDefault<Type,Value>` alias) -> CodegenTypes.WithDefault<Type,Value>`
 * loses the real type arguments and fails with "The default value in
 * WithDefault must be string, number, boolean or null." Referencing
 * `CodegenTypes.WithDefault<...>` directly (qualified) avoids the extra
 * alias hop and keeps the real arguments intact.
 */
import {
  codegenNativeCommands,
  codegenNativeComponent,
  type CodegenTypes,
  type ColorValue,
  type HostComponent,
  type ViewProps,
} from 'react-native';
import type * as React from 'react';

type NativeBlurMode = CodegenTypes.WithDefault<'static' | 'live', 'static'>;
type NativeBlurQuality = CodegenTypes.WithDefault<
  'high' | 'balanced' | 'performance',
  'balanced'
>;

export interface NativeProps extends ViewProps {
  blurRadius?: CodegenTypes.WithDefault<CodegenTypes.Double, 0>;
  mode?: NativeBlurMode;
  overlayColor?: ColorValue;
  saturation?: CodegenTypes.WithDefault<CodegenTypes.Double, 1>;
  quality?: NativeBlurQuality;
  // 0 = 'auto' sentinel; see file-level deviation note above.
  downsample?: CodegenTypes.WithDefault<CodegenTypes.Int32, 0>;
  maxFps?: CodegenTypes.WithDefault<CodegenTypes.Int32, 30>;
  fallbackColor?: ColorValue;
}

type ComponentType = HostComponent<NativeProps>;

interface NativeCommands {
  refresh: (viewRef: React.ComponentRef<ComponentType>) => void;
}

export const Commands: NativeCommands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['refresh'],
});

export default codegenNativeComponent<NativeProps>(
  'ParityBlurView'
) as ComponentType;
