// ============================================================================
// Attributes & Uniforms
// ============================================================================
// Note: utility and fractal includes are added in Grass.tsx via template strings
attribute vec3 instanceOffset;
attribute float instanceId; // instance index for texture lookup
uniform sampler2D uBladeParamsTexture; // FBO texture with blade params
uniform sampler2D uClumpDataTexture; // FBO texture with clump data
uniform sampler2D uMotionSeedsTexture; // MotionSeedsRT: facingAngle01, perBladeHash01, windStrength01, lodSeed01
uniform vec2 uGrassTextureSize; // texture resolution (GRID_SIZE)

uniform float thicknessStrength;

// Wind uniforms
uniform float uTime;
uniform float uWindStrength; // Still needed for scaling wind effects in vertex shader
uniform vec2 uWindDir; // Wind direction for sway direction (Step 3)
// Note: uWindSpeed is only used in compute shader for wind field translation, not for sway frequency

// ============================================================================
// Varyings
// ============================================================================
varying float vHeight;
varying vec2 vUv;
varying float vType;
varying float vPresence;
varying vec3 vTest;
varying vec3 vN;
varying vec3 vTangent;
varying vec3 vSide;
varying vec2 vToCenter;
varying vec3 vWorldPos;

// ============================================================================
// Hash Functions (only for wind/random effects, not for clump/params)
// ============================================================================
float hash11(float x) {
  return fract(sin(x * 37.0) * 43758.5453123);
}

// Note: Wind sampling is now done in compute shader and passed via MotionSeedsRT
// This ensures coherence across the entire pipeline (compute -> vertex -> fragment)

// ============================================================================
// Utility Functions
// ============================================================================
// Safe normalize to avoid NaN when vector is zero
vec2 safeNormalize(vec2 v) {
  float m2 = dot(v, v);
  return (m2 > 1e-6) ? v * inversesqrt(m2) : vec2(1.0, 0.0);
}

// ============================================================================
// Bezier Curve Functions
// ============================================================================
// Cubic Bezier (4 control points) - matches Ghost implementation
vec3 bezier3(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
  float u = 1.0 - t;
  return u*u*u*p0 + 3.0*u*u*t*p1 + 3.0*u*t*t*p2 + t*t*t*p3;
}

vec3 bezier3Tangent(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
  float u = 1.0 - t;
  return 3.0*u*u*(p1-p0) + 6.0*u*t*(p2-p1) + 3.0*t*t*(p3-p2);
}

// ============================================================================
// Main Vertex Shader
// ============================================================================
void main() {
  // 1. UV and Basic Setup
  float t = uv.y;
  float s = (uv.x - 0.5) * 2.0;
  vec2 worldXZ = instanceOffset.xz;

  // 2. Calculate texture coordinates from instance ID (direct integer conversion)
  int ix = int(mod(instanceId, uGrassTextureSize.x));
  int iy = int(floor(instanceId / uGrassTextureSize.x));
  ivec2 texelCoord = ivec2(ix, iy);

  // 3. Read Precomputed Data from FBO textures using texelFetch
  vec4 bladeParams = texelFetch(uBladeParamsTexture, texelCoord, 0);
  vec4 clumpData = texelFetch(uClumpDataTexture, texelCoord, 0);
  vec4 motionSeeds = texelFetch(uMotionSeedsTexture, texelCoord, 0);
  
  vec2 toCenter = clumpData.xy;
  float presence = clumpData.z;
  
  // Extract MotionSeedsRT data
  float facingAngle01 = motionSeeds.x; // [0, 1] corresponding to [0, 2π]
  float perBladeHash01 = motionSeeds.y; // [0, 1] per-blade hash (coherent across frames)
  float windStrength01 = motionSeeds.z; // [0, 1] wind strength sampled at blade position
  float lodSeed01 = motionSeeds.w; // [0, 1] LOD culling seed

  float height = bladeParams.x;
  float width = bladeParams.y;
  float bend = bladeParams.z;
  float bladeType = bladeParams.w;

  // Use windStrength01 from compute shader (coherent across pipeline)
  float wind = windStrength01; // Already in [0, 1] range from compute shader
  
  float windS =  wind * uWindStrength;
  
  // Use facingAngle01 from compute shader (convert from [0, 1] to radians)
  float facingAngle = facingAngle01 * 6.28318530718; // Convert [0, 1] to [0, 2π]
  float anglePre = facingAngle; // Use compute-generated facing angle directly
  
  // Blade facing in XZ (object space)
  vec2 facingXZ = vec2(cos(anglePre), sin(anglePre));
  // Horizontal perpendicular (left/right) - used for blade width/side direction
  vec2 perpXZ = vec2(-facingXZ.y, facingXZ.x);
  
  // Wind direction vector (for large-scale wind push, not blade-specific)
  // Use safeNormalize to avoid NaN when uWindDir is zero vector
  vec2 windDir = safeNormalize(uWindDir);
  vec3 windPushDir = vec3(windDir.x, 0.0, windDir.y);
  
  // 4. Cubic Bezier Curve Shape Generation (4 control points - matches Ghost)
  // p0 = base (root, fixed)
  vec3 p0 = vec3(0.0, 0.0, 0.0);
  // p3 = tip (top of blade)
  vec3 p3 = vec3(0.0, height, 0.0);
  
  // p1, p2 = mid control points (control bend and wind response)
  vec3 p1, p2;
  if (bladeType < 0.5) {
    p1 = vec3(0.0, height * 0.4, bend * 0.5);  // Lower mid control point
    p2 = vec3(0.0, height * 0.75, bend * 0.7); // Upper mid control point
  } else if (bladeType < 1.5) {
    p1 = vec3(0.0, height * 0.35, bend * 0.6);
    p2 = vec3(0.0, height * 0.7, bend * 0.8);
  } else {
    p1 = vec3(0.0, height * 0.3, bend * 0.7);
    p2 = vec3(0.0, height * 0.65, bend * 1.0);
  }
  
  // Wind push along wind direction (Ghost-style: large-scale displacement follows wind)
  // Ghost-style: root stable (p0), mid moderate (p1, p2), tip strongest (p3)
  float tipPush = windS * height * 0.35;
  float midPush1 = windS * height * 0.1;  // Lower mid push
  float midPush2 = windS * height * 0.2; // Upper mid push
  
  p1 += windPushDir * midPush1;
  p2 += windPushDir * midPush2;
  p3 += windPushDir * tipPush;
  
  // Bobbing phase (high frequency sway) - use perBladeHash01 from compute shader for coherence
  // Step 4: Add second layer wind noise for more complex motion (Ghost-style)
  // This adds subtle per-blade variation without breaking large-scale flow
  // Note: uWindSpeed is only for wind field translation, not sway frequency
  // Sway frequency should be independent to avoid over-synchronization with gusts
  float phase = perBladeHash01 * 6.28318 + windStrength01 * 2.0;
  float swayAmt = uWindStrength * 0.02 * height * wind;
  
  // Multi-point sway for more fluid motion (not just tip swaying)
  // Different phases at different heights create wave-like flow
  float sway1 = sin(uTime * (1.8 + wind * 1.2) + phase + 0.7 * 2.2);
  float sway2 = sin(uTime * (1.8 + wind * 1.2) + phase + 0.85 * 2.2);
  float sway = sin(uTime * (1.8 + wind * 1.2) + phase + t * 2.2);
  
  // Apply bobbing sway along wind direction with different weights at different control points
  p1 += windPushDir * (sway1 * swayAmt * 0.25);
  p2 += windPushDir * (sway2 * swayAmt * 0.55);
  p3 += windPushDir * (sway * swayAmt * 1.00);
  
  // Recalculate spine and tangent after all wind effects using cubic bezier
  vec3 spine = bezier3(p0, p1, p2, p3, t);
  vec3 tangent = normalize(bezier3Tangent(p0, p1, p2, p3, t));

  // 5. TBN Frame Construction (UE-style Derive Normals)
  vec3 ref = vec3(0.0, 0.0, 1.0);
  vec3 side = normalize(cross(ref, tangent));
  vec3 normal = normalize(cross(side, tangent));

  // 6. Blade Geometry (simplified width calculation)
  float baseWidth = 0.35; // Can be made an attribute later if needed
  float tipThin = 0.9; // Can be made an attribute later if needed
  float widthFactor = (t + baseWidth) * pow(1.0 - t, tipThin);
  vec3 lpos = spine + side * width * widthFactor * s * presence;
  
  // Additional tip-weighted wind push (Ghost-style: root 0, tip strong)
  // Note: Removed duplicate wind push - wind effects are now handled in bezier control points above
  // float tipWeight = smoothstep(0.1, 1.0, t);
  // lpos += vec3(perpXZ.x, 0.0, perpXZ.y) * (windS * height * 0.05) * tipWeight;
  
  // Step 3: Apply sway offset using full wind direction vector
  // COMMENTED OUT: Avoid double wind push - sway is now handled in bezier control points above
  // vec2 windDir = normalize(uWindDir);
  // float windPush = windS * height * 0.05;
  // vec3 swayOffset = vec3(0.0);
  // swayOffset.x += windDir.x * windPush * tipWeight * sway;
  // swayOffset.z += windDir.y * windPush * tipWeight * sway;
  // lpos += swayOffset;
  
  // 7. Apply rotation using pre-calculated angle
  float angle = anglePre;
  
  lpos.xz = rotate2D(lpos.xz, angle);
  tangent.xz = rotate2D(tangent.xz, angle);
  side.xz = rotate2D(side.xz, angle);
  // normal.xz = rotate2D(normal.xz, angle);
  
  tangent = normalize(tangent);
  side = normalize(side);
  normal = normalize(normal);
  
  // 8. Transform to World Space
  vec3 posObj = lpos + instanceOffset;
  vec3 posW = (modelMatrix * vec4(posObj, 1.0)).xyz;
  
  // 9. View-dependent Tilt (Ghost/UE-style)
  vec3 camDirW = normalize(cameraPosition - posW);
  
  vec3 tangentW = normalize((modelMatrix * vec4(tangent, 0.0)).xyz);
  vec3 sideW = normalize((modelMatrix * vec4(side, 0.0)).xyz);
  vec3 normalW = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  
  mat3 toLocal = mat3(tangentW, sideW, normalW);
  vec3 camDirLocal = normalize(transpose(toLocal) * camDirW);
  
  // Edge mask (UE graph logic)
  float edgeMask = (uv.x - 0.5) * camDirLocal.y;
  float weight = pow(abs(camDirLocal.y), 1.2);
  edgeMask *= weight;
  edgeMask = clamp(edgeMask, 0.0, 1.0);
  
  // Height mask
  float centerMask = pow(1.0 - t, 0.5) * pow(t + 0.05, 0.33);
  centerMask = clamp(centerMask, 0.0, 1.0);
  
  // Combine and apply tilt
  float tilt = thicknessStrength * edgeMask * centerMask;
  vec3 nXZ = normalize(normal * vec3(1.0, 0.0, 1.0));
  vec3 posObjTilted = posObj + nXZ * tilt;
  
  // Update world position with tilted position
  vec3 posWTilted = (modelMatrix * vec4(posObjTilted, 1.0)).xyz;

  // 10. CSM Output
  csm_Position = posObjTilted;

  // 11. Varyings
  vN = -normal;
  vTangent = tangent;
  vSide = side;
  vToCenter = toCenter;
  vWorldPos = posWTilted;
  vTest = vec3(toCenter.x, toCenter.y, 0.0);
  vUv = uv;
  vHeight = t;
  vType = bladeType;
  vPresence = presence;
}

