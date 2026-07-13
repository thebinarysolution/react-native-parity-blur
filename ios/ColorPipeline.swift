import Foundation
import simd

/// Post-blur color pass (spec §9 steps 9-11): fractional crop (bilinear), saturation matrix,
/// overlay source-over — one compute dispatch writing straight into the CAMetalLayer drawable.
/// All math matches PipelineMath/{saturationMatrix,sourceOver} exactly; the fixture suite pins
/// the CPU reference, and M5 calibration compares the GPU output cross-platform.
enum ColorPipeline {

  /// Uniforms layout shared with the MSL kernel below (float4 alignment).
  struct Uniforms {
    /// Fractional crop origin inside the blurred snapshot texture, snapshot px.
    var cropOrigin: SIMD2<Float>
    var _pad: SIMD2<Float> = .zero
    /// Saturation matrix rows (RGB coefficients only; offsets are all 0 per spec §7).
    var satR: SIMD4<Float>
    var satG: SIMD4<Float>
    var satB: SIMD4<Float>
    /// Overlay color, STRAIGHT alpha (spec §8).
    var overlay: SIMD4<Float>
  }

  static func uniforms(
    cropX: Double, cropY: Double, saturation: Double, overlay: PipelineMath.RGBA
  ) -> Uniforms {
    let m = PipelineMath.saturationMatrix(saturation)
    return Uniforms(
      cropOrigin: SIMD2(Float(cropX), Float(cropY)),
      satR: SIMD4(Float(m[0]), Float(m[1]), Float(m[2]), 0),
      satG: SIMD4(Float(m[5]), Float(m[6]), Float(m[7]), 0),
      satB: SIMD4(Float(m[10]), Float(m[11]), Float(m[12]), 0),
      overlay: SIMD4(Float(overlay.r), Float(overlay.g), Float(overlay.b), Float(overlay.a))
    )
  }

  /// v1 backdrop is opaque (spec §6): source-over reduces to srcC*srcA + dstC*(1-srcA), out a=1.
  /// The sampler is linear so the fractional crop origin is resolved by bilinear filtering
  /// (spec §3.4); reads are raw encoded values (gamma-space, .bgra8Unorm view) so saturation and
  /// overlay composite in the same domain as Android's ColorMatrix/Paint pipeline.
  static let metalSource = """
  #include <metal_stdlib>
  using namespace metal;

  struct PBUniforms {
    float2 cropOrigin;
    float2 _pad;
    float4 satR;
    float4 satG;
    float4 satB;
    float4 overlay;
  };

  kernel void parityblur_post(
      texture2d<float, access::sample> src [[texture(0)]],
      texture2d<float, access::write> dst [[texture(1)]],
      sampler linearSampler [[sampler(0)]],
      constant PBUniforms &u [[buffer(0)]],
      uint2 gid [[thread_position_in_grid]]) {
    if (gid.x >= dst.get_width() || gid.y >= dst.get_height()) {
      return;
    }
    float2 srcSize = float2(src.get_width(), src.get_height());
    float2 coord = (u.cropOrigin + float2(gid) + 0.5) / srcSize;
    float3 c = src.sample(linearSampler, coord).rgb;
    float3 sat = clamp(
        float3(dot(c, u.satR.rgb), dot(c, u.satG.rgb), dot(c, u.satB.rgb)),
        0.0, 1.0);
    float3 outc = u.overlay.rgb * u.overlay.a + sat * (1.0 - u.overlay.a);
    dst.write(float4(outc, 1.0), gid);
  }
  """
}
