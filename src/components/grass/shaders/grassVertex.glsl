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

#define GRID_SIZE 256.0
#define PATCH_SIZE 8.0

uniform float thicknessStrength;

// Wind uniforms (uWindDir and uWindSpeed removed - wind sampling now in compute shader)
uniform float uTime;
uniform float uWindStrength; // Still needed for scaling wind effects in vertex shader

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
// Bezier Curve Functions
// ============================================================================
vec3 bezier2(vec3 p0, vec3 p1, vec3 p2, float t) {
  float u = 1.0 - t;
  return u*u*p0 + 2.0*u*t*p1 + t*t*p2;
}

vec3 bezier2Tangent(vec3 p0, vec3 p1, vec3 p2, float t) {
  return 2.0*(1.0 - t)*(p1 - p0) + 2.0*t*(p2 - p1);
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
  float baseAngle = clumpData.w; // Keep for backward compatibility, but use facingAngle01 instead
  
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
  
  // Convert windStrength01 to wind scalar [-1, 1] range
  float windS = (wind * 2.0 - 1.0) * uWindStrength;
  
  // Use facingAngle01 from compute shader (convert from [0, 1] to radians)
  float facingAngle = facingAngle01 * 6.28318530718; // Convert [0, 1] to [0, 2π]
  float anglePre = facingAngle; // Use compute-generated facing angle directly
  
  // Blade facing in XZ (object space)
  vec2 facingXZ = vec2(cos(anglePre), sin(anglePre));
  // Horizontal perpendicular (left/right) - this is the direction wind pushes
  vec2 perpXZ = vec2(-facingXZ.y, facingXZ.x);
  
  // 4. Bezier Curve Shape Generation
  vec3 p0 = vec3(0.0, 0.0, 0.0);
  vec3 p2 = vec3(0.0, height, 0.0);
  
  vec3 p1;
  if (bladeType < 0.5) {
    p1 = vec3(0.0, height * 0.9, bend * 0.7);
  } else if (bladeType < 1.5) {
    p1 = vec3(0.0, height * 0.85, bend * 0.8);
  } else {
    p1 = vec3(0.0, height * 0.8, bend * 1.0);
  }
  
  // Wind push along blade perpendicular direction (consistent with facing)
  float tipPush = windS * height * 0.35;
  float midPush = windS * height * 0.15;
  
  p1 += vec3(perpXZ.x, 0.0, perpXZ.y) * midPush;
  p2 += vec3(perpXZ.x, 0.0, perpXZ.y) * tipPush;
  
  // Bobbing phase (high frequency sway) - use perBladeHash01 from compute shader for coherence
  float phase = perBladeHash01 * 6.28318; // Use compute-generated hash (already in [0, 1])
  float sway = sin(uTime * (1.8 + wind * 1.2) + phase + t * 2.2);
  float swayAmt = uWindStrength * 0.02 * height * wind;
  
  // Apply bobbing sway along perpendicular direction
  p2 += vec3(perpXZ.x, 0.0, perpXZ.y) * (sway * swayAmt);
  
  // Recalculate spine and tangent after all wind effects
  vec3 spine = bezier2(p0, p1, p2, t);
  vec3 tangent = normalize(bezier2Tangent(p0, p1, p2, t));

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
  float tipWeight = smoothstep(0.1, 1.0, t);
  lpos += vec3(perpXZ.x, 0.0, perpXZ.y) * (windS * height * 0.05) * tipWeight;
  
  // 7. Apply rotation using pre-calculated angle
  float angle = anglePre;
  
  lpos.xz = rotate2D(lpos.xz, angle);
  tangent.xz = rotate2D(tangent.xz, angle);
  side.xz = rotate2D(side.xz, angle);
  normal.xz = rotate2D(normal.xz, angle);
  
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
  vTest = vec3(edgeMask, 0.0, 0.0);
  vUv = uv;
  vHeight = t;
  vType = bladeType;
  vPresence = presence;
}

