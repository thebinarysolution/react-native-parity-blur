# Canonical Pipeline Specification (normative)

Status: LOCKED at Milestone 2. Constants remain provisional-until-M5 per MASTER_PLAN §5.2/§38,
but any change must be made here, in `src/pipeline/` (the executable reference), and in both
native backends together.

Both native backends implement THIS document. The pure-TypeScript reference implementation in
`src/pipeline/` is the executable form of this spec; the language-neutral fixture table
`test/pipeline-fixtures.json` is consumed by the JS suite (`__tests__/pipeline.test.ts`) and by
the native test suites in M3/M4. When this document and the reference disagree, that is a bug:
fix one to match the other in the same change.

## 1. Units

| symbol | definition |
|---|---|
| `blurRadius` | PUBLIC prop: Gaussian **sigma in dp** (iOS pt ≡ Android dp semantically) |
| `displayScale` | device pixels per dp (`UIScreen.scale` / `displayMetrics.density`) |
| `sigmaPx` | `blurRadius × displayScale` (device px) — `units.sigmaPxFromDp` |
| `D` | downsample factor ∈ {1, 2, 4, 8} |
| `sigmaSnapshot` | `sigmaPx / D` (snapshot px) — `units.sigmaSnapshotFromPx` |

Non-finite or non-positive inputs clamp to 0 (no blur). The blur backend always receives a
parameter derived from `sigmaSnapshot`.

## 2. Platform blur-parameter conversion

| platform | backend | parameter | conversion |
|---|---|---|---|
| iOS | `MPSImageGaussianBlur(sigma:)` | sigma, snapshot px | `sigma = sigmaSnapshot` (identity) |
| Android 31+ | `RenderEffect.createBlurEffect(radius, radius, CLAMP)` | platform radius | `radius = (sigmaSnapshot − 0.5) / 0.57735` |

The Android relation inverts HWUI's `sigma = 0.57735·radius + 0.5` (verified exact on device,
M0). `sigmaSnapshot ≤ 0.5` → **no-blur passthrough** (present the un-blurred snapshot; do not
pass radius ≤ 0 to RenderEffect). The constants live in exactly one place per language:
`pipeline/constants.ts` (`HWUI_SIGMA_SLOPE`, `HWUI_SIGMA_INTERCEPT`), Kotlin
`AndroidBlurCalibration`, and nowhere else. Version-aware calibration groups (§5.2 of the plan)
may later key these by API level without touching call sites.

## 3. Capture-rect math (`pipeline/captureRect.ts`)

All rects are target-local **device px** unless stated. Origin top-left.

1. **Support margin**: `marginPx = ceil(K · sigmaPx)`, `K = 3` (`CAPTURE_SUPPORT_K`).
2. **Expansion**: expand the visible rect by `marginPx` on all four sides, then clamp by
   intersection with the target bounds.
3. **Snapshot rect** (integer snapshot px): origin **floors**, far edge **ceils**:
   `x = floor(captureX / D)`, `farX = ceil((captureX + captureW) / D)`, `width = farX − x`
   (and likewise for y). This conservative cover guarantees every device pixel of the capture
   rect lands in the snapshot; naive `ceil(width/D)` does not and is forbidden.
4. **Crop rect** (fractional snapshot px; selects the visible region after blur):
   `cropX = visibleX / D − snapshotX`, `cropW = visibleW / D`. The fractional origin remainder
   in [0,1) snapshot px is resolved by the bilinear upsample — do not round it away.
5. **Round-trip invariant**: mapping crop → device px recovers the visible rect within
   **D/2 device px** (half a snapshot pixel). The jest property test pins this.

## 4. Downsample selection (`pipeline/downsample.ts`)

`downsample='auto'` resolves via `autoDownsample(sigmaPx, captureAreaPx, quality)`:
the largest factor in {8,4,2,1} satisfying ALL of:

| ceiling | rule |
|---|---|
| quality | `high → ≤2`, `balanced → ≤4`, `performance → ≤8` (`QUALITY_MAX_DOWNSAMPLE`) |
| sigma floor | `D ≤ floor(sigmaPx / 1.0)` — keeps `sigmaSnapshot ≥ 1` (`MIN_SIGMA_SNAPSHOT`) |
| small-capture | capture area < 256² device px² → `D ≤ 2` (`SMALL_CAPTURE_AREA_PX`) |

`sigmaPx ≤ 0` → `D = 1`. An explicit numeric prop value bypasses selection verbatim.
Both backends must select identically for identical inputs; the fixture table includes the
decision breakpoints.

## 5. Edge semantics

- Capture expansion (§3) is the PRIMARY edge-correctness mechanism.
- The blur's tile/edge mode covers only the clamped outer boundary of the expanded rect:
  Android `Shader.TileMode.CLAMP`; iOS `MPSImageGaussianBlur.edgeMode = .clamp`.
- Mirrored, transparent-black, or default edge behavior is forbidden (plan §8).

## 6. Color pipeline

- Convolution domain: **gamma-space (sRGB-encoded values)** on both platforms — Skia/HWUI
  native behavior; iOS must use non-sRGB texture views (`bgra8Unorm`, NOT `bgra8Unorm_srgb`)
  so MPS convolves the encoded values (M0-verified discriminator: gamma midpoint ≈ 0.26 vs
  linear ≈ 0.11 on a black→gray-128 step).
- Representation: **premultiplied BGRA8** on both platforms. In v1 the captured backdrop is
  opaque-composited (`alpha = 1`) so premultiplication is visually inert, but the
  representation is locked now so translucent-capture support cannot fork the backends later.
- Saturation and overlay math (below) are DEFINED on straight-alpha values; on premultiplied
  surfaces with `a = 1` straight and premultiplied coincide, so v1 backends may apply them
  directly. Any future translucent path must unpremultiply → apply → repremultiply.

## 7. Saturation (`pipeline/saturation.ts`)

`saturation` prop `s ≥ 0`; `1` = identity, `0` = Rec.709 grayscale. Applied AFTER blur,
BEFORE overlay. One canonical row-major 4×5 matrix (Android `ColorMatrix` layout; iOS
transposes into a 4×4 + bias for Metal/vImage), with `t = 1 − s`, luma = (0.2126, 0.7152, 0.0722):

```
[ t·lr+s  t·lg    t·lb    0  0 ]
[ t·lr    t·lg+s  t·lb    0  0 ]
[ t·lr    t·lg    t·lb+s  0  0 ]
[ 0       0       0       1  0 ]
```

RGB outputs clamp to [0,1]; alpha row untouched; all offsets 0.

## 8. Overlay (`pipeline/overlay.ts`, `pipeline/color.ts`)

`overlayColor` (default transparent = none) is parsed to straight-alpha RGBA and composited
**source-over** onto the saturated blur result — the ONLY tint in the pipeline:

```
outA = srcA + dstA·(1 − srcA)
outC = (srcC·srcA + dstC·dstA·(1 − srcA)) / outA     (outA > 0, else 0)
```

v1 (`dstA = 1`): `outC = srcC·srcA + dstC·(1 − srcA)`, `outA = 1`. Unparseable colors resolve
to transparent (no overlay) with a DEV warning at the JS layer.

## 9. Canonical pipeline order (plan §6, annotated)

| # | step | notes (provider/mode) |
|---|---|---|
| 1 | resolve blur view bounds | native, both |
| 2 | resolve capture target | default root content; `blurTarget` ref override |
| 3 | convert coordinates | view → window → target-local (§18 of plan) |
| 4 | expand for Gaussian support | §3 above |
| 5 | exclude blur presentation surfaces | Android software pass: `draw(Canvas)` override; Android RenderNode pass: STRUCTURAL only (descendant → fall back to software provider + DEV warn); iOS: `CALayer.render` model-state exclusion |
| 6 | capture source content | Android in-tree: software canvas → ARGB_8888 bitmap; Android structural: RenderNode live references; iOS: `LayerRenderSnapshotProvider` (clip mandatory) |
| 7 | downsample | §4; capture directly at snapshot scale where the API allows |
| 8 | gaussian blur | §2; CLAMP edges §5 |
| 9 | saturation | §7 |
| 10 | overlay source-over | §8 |
| 11 | crop valid center region | §3 crop rect |
| 12 | upsample | bilinear, both platforms |
| 13 | rounded clipping | §31 of plan; blur-output clip ≠ child clip |
| 14 | present | Android: RenderNode draw; iOS: CAMetalLayer drawable |

Ordering must not vary between platforms. On the Android structural path, steps 6–8 execute
implicitly per frame by HWUI (live references + RenderEffect); steps 9–10 fold into the same
RenderNode's effect chain.

## 10. Generation rules (plan §23, contract form)

| generation | bumped by | consumers must |
|---|---|---|
| captureGeneration | every capture request | drop async results whose token ≠ current |
| layoutGeneration | size/position change of view or target | recapture (static) / re-plan (live) |
| targetGeneration | blurTarget resolution change | invalidate capture plan |
| windowGeneration | window attach/detach/migration | tear down per-window registration |

Any async completion (software rasterization, GPU completion handler) compares its captured
tokens against current values before presenting; stale → discard silently.

## 11. Fixture contract

`test/pipeline-fixtures.json` is language-neutral: `{input..., expected...}` rows per pure
function, covering the boundaries (sigma 0 / 0.5 threshold; D breakpoints incl. the small-capture
cap; rect clamping at target edges; s = 0/0.5/1/2 matrices; overlay a = 0/0.35/1; color parsing).
M3 (Kotlin) and M4 (Swift) must ship a test that loads THIS file and asserts equality within
1e-6 for every row.
