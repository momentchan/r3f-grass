// ============================================================================
// Attributes & Uniforms
// ============================================================================
attribute vec3 instanceOffset;
attribute float instanceId;
uniform sampler2D uBladeParamsTexture;
uniform sampler2D uClumpDataTexture;
uniform sampler2D uMotionSeedsTexture;
uniform vec2 uGrassTextureSize;

uniform float thicknessStrength;
uniform float uTime;
uniform float uWindStrength;
uniform vec2 uWindDir;
uniform float uSwayFreqMin;
uniform float uSwayFreqMax;
uniform float uSwayStrength;

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
// Utility Functions
// ============================================================================
vec2 safeNormalize(vec2 v) {
  float m2 = dot(v, v);
  return (m2 > 1e-6) ? v * inversesqrt(m2) : vec2(1.0, 0.0);
}

// ============================================================================
// Bezier Curve Functions
// ============================================================================
vec3 bezier3(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
  float u = 1.0 - t;
  return u*u*u*p0 + 3.0*u*u*t*p1 + 3.0*u*t*t*p2 + t*t*t*p3;
}

vec3 bezier3Tangent(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
  float u = 1.0 - t;
  return 3.0*u*u*(p1-p0) + 6.0*u*t*(p2-p1) + 3.0*t*t*(p3-p2);
}

// ============================================================================
// Wind Functions
// ============================================================================
vec3 getWindDirection() {
  return vec3(safeNormalize(uWindDir), 0.0).xzy;
}

void applyWindPush(inout vec3 p1, inout vec3 p2, inout vec3 p3, float windStrength01, float height) {
  vec3 windDir = getWindDirection();
  float windScale = windStrength01 * uWindStrength;
  
  float tipPush = windScale * height * 0.25;
  float midPush1 = windScale * height * 0.08;
  float midPush2 = windScale * height * 0.15;
  
  p1 += windDir * midPush1;
  p2 += windDir * midPush2;
  p3 += windDir * tipPush;
}

void applyWindSway(
  inout vec3 p1, inout vec3 p2, inout vec3 p3,
  float windStrength01, float height, float perBladeHash01, float t,
  vec2 worldXZ
) {
  // Two directions: along wind + cross wind (adds natural "twist")
  vec3 W = getWindDirection();                              // along wind
  vec3 CW = normalize(vec3(-W.z, 0.0, W.x));               // cross wind
  vec2 windDir2 = vec2(W.x, W.z);                           // 2D wind dir for wave calculation

  // Gust envelope (slow breathing)
  float seed = mod(perBladeHash01 * 3.567, 1.0); 
  float gust = 0.65 + 0.35 * sin(uTime * 0.35 + seed * 6.28318);

  // Traveling wave along wind direction (big-scale flow)
  float wave = dot(worldXZ, windDir2) * 0.15; // 0.10~0.25 usually good

  // Per-blade frequency variation: mix between min and max based on hash
  float baseFreq = mix(uSwayFreqMin, uSwayFreqMax, seed);
  float phase = perBladeHash01 * 6.28318 + wave;

  // Low freq (main sway) + high freq (small flutter)
  float low  = sin(uTime * baseFreq + phase + t * 2.2);
  float high = sin(uTime * (baseFreq * 5.0) + phase * 1.7 + t * 5.0);

  // Amplitude: keep it small. (your old 2.2 is the reason it's jelly)
  float amp = uWindStrength * height * windStrength01;
  float swayLow  = amp * gust * uSwayStrength;  // main motion
  float swayHigh = amp * 0.8 * uSwayStrength;         // small detail

  // Direction blend: mostly wind, a bit cross wind driven by high component
  vec3 dir = normalize(W + CW * (high * 0.35));

  // Apply on control points (root stable, tip strongest)
  p1 += dir * (low * swayLow * 0.25 + high * swayHigh * 0.25 * 0.3);
  p2 += dir * (low * swayLow * 0.55 + high * swayHigh * 0.55 * 0.6);
  p3 += dir * (low * swayLow * 1.00 + high * swayHigh * 1.00 * 1.0);
}

// ============================================================================
// Blade Shape Functions
// ============================================================================
void getBezierControlPoints(float bladeType, float height, float bend, out vec3 p1, out vec3 p2) {
  if (bladeType < 0.5) {
    p1 = vec3(0.0, height * 0.4, bend * 0.5);
    p2 = vec3(0.0, height * 0.75, bend * 0.7);
  } else if (bladeType < 1.5) {
    p1 = vec3(0.0, height * 0.35, bend * 0.6);
    p2 = vec3(0.0, height * 0.7, bend * 0.8);
  } else {
    p1 = vec3(0.0, height * 0.3, bend * 0.7);
    p2 = vec3(0.0, height * 0.65, bend * 1.0);
  }
}

// ============================================================================
// Main Vertex Shader
// ============================================================================
void main() {
  // 1. UV Setup
  float t = uv.y;
  float s = (uv.x - 0.5) * 2.0;

  // 2. Texture Coordinates
  int ix = int(mod(instanceId, uGrassTextureSize.x));
  int iy = int(floor(instanceId / uGrassTextureSize.x));
  ivec2 texelCoord = ivec2(ix, iy);

  // 3. Read Precomputed Data
  vec4 bladeParams = texelFetch(uBladeParamsTexture, texelCoord, 0);
  vec4 clumpData = texelFetch(uClumpDataTexture, texelCoord, 0);
  vec4 motionSeeds = texelFetch(uMotionSeedsTexture, texelCoord, 0);
  
  float height = bladeParams.x;
  float width = bladeParams.y;
  float bend = bladeParams.z;
  float bladeType = bladeParams.w;
  
  vec2 toCenter = clumpData.xy;
  float presence = clumpData.z;
  
  float facingAngle01 = motionSeeds.x;
  float perBladeHash01 = motionSeeds.y;
  float windStrength01 = motionSeeds.z;
  
  float facingAngle = facingAngle01 * PI * 2.0;

  // 4. Bezier Control Points
  vec3 p0 = vec3(0.0, 0.0, 0.0);
  vec3 p3 = vec3(0.0, height, 0.0);
  vec3 p1, p2;
  getBezierControlPoints(bladeType, height, bend, p1, p2);

  // 5. Apply Wind Effects
  applyWindPush(p1, p2, p3, windStrength01, height);
  applyWindSway(p1, p2, p3, windStrength01, height, perBladeHash01, t, instanceOffset.xz);

  // 6. Calculate Spine and Tangent
  vec3 spine = bezier3(p0, p1, p2, p3, t);
  vec3 tangent = normalize(bezier3Tangent(p0, p1, p2, p3, t));

  // 7. TBN Frame
  vec3 ref = vec3(0.0, 0.0, 1.0);
  vec3 side = normalize(cross(ref, tangent));
  vec3 normal = normalize(cross(side, tangent));

  // 8. Blade Geometry
  float baseWidth = 0.35;
  float tipThin = 0.9;
  float widthFactor = (t + baseWidth) * pow(1.0 - t, tipThin);
  vec3 lpos = spine + side * width * widthFactor * s * presence;

  // 9. Apply Rotation
  lpos.xz = rotate2D(lpos.xz, facingAngle);
  tangent.xz = rotate2D(tangent.xz, facingAngle);
  side.xz = rotate2D(side.xz, facingAngle);
  
  tangent = normalize(tangent);
  side = normalize(side);
  normal = normalize(normal);

  // 10. Transform to World Space
  vec3 posObj = lpos + instanceOffset;
  vec3 posW = (modelMatrix * vec4(posObj, 1.0)).xyz;

  // 11. View-dependent Tilt
  vec3 camDirW = normalize(cameraPosition - posW);
  
  vec3 tangentW = normalize((modelMatrix * vec4(tangent, 0.0)).xyz);
  vec3 sideW = normalize((modelMatrix * vec4(side, 0.0)).xyz);
  vec3 normalW = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  
  mat3 toLocal = mat3(tangentW, sideW, normalW);
  vec3 camDirLocal = normalize(transpose(toLocal) * camDirW);
  
  float edgeMask = (uv.x - 0.5) * camDirLocal.y;
  edgeMask *= pow(abs(camDirLocal.y), 1.2);
  edgeMask = clamp(edgeMask, 0.0, 1.0);
  
  float centerMask = pow(1.0 - t, 0.5) * pow(t + 0.05, 0.33);
  centerMask = clamp(centerMask, 0.0, 1.0);
  
  float tilt = thicknessStrength * edgeMask * centerMask;
  vec3 nXZ = normalize(normal * vec3(1.0, 0.0, 1.0));
  vec3 posObjTilted = posObj + nXZ * tilt;
  vec3 posWTilted = (modelMatrix * vec4(posObjTilted, 1.0)).xyz;

  // 12. Output
  csm_Position = posObjTilted;

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
