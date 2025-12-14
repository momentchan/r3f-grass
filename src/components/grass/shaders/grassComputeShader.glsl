uniform vec2 uResolution;
uniform sampler2D uPositions; // instanceOffset positions
uniform float bladeHeight;
uniform float bladeWidth;
uniform float bendAmount;
uniform float clumpSize;
uniform float clumpRadius;
// Wind uniforms for compute pass
uniform float uTime;
uniform float uWindScale;
uniform float uWindSpeed;

// Multiple render targets output declarations (WebGL2/GLSL ES 3.00)
layout(location = 0) out vec4 outBladeParams; // bladeParams: height, width, bend, type
layout(location = 1) out vec4 outClumpData; // clumpData: toCenter.x, toCenter.y, presence, baseAngle
layout(location = 2) out vec4 outMotionSeeds; // MotionSeedsRT: facingAngle01, perBladeHash01, windStrength01, lodSeed01

// Hash functions (matching CPU version exactly)
float hash11(float x) {
  return fract(sin(x * 37.0) * 43758.5453123);
}

vec2 hash21(vec2 p) {
  float h1 = hash11(dot(p, vec2(127.1, 311.7)));
  float h2 = hash11(dot(p, vec2(269.5, 183.3)));
  return vec2(h1, h2);
}

vec2 hash2(vec2 p) {
  float x = dot(p, vec2(127.1, 311.7));
  float y = dot(p, vec2(269.5, 183.3));
  return fract(sin(vec2(x, y)) * 43758.5453);
}

// Note: simplexNoise3d and fbm2 are now included from fractal.glsl via useGrassCompute hook

// Voronoi clump calculation (matching CPU version exactly)
// Returns: distToCenter, cellId.x, cellId.y
vec3 getClumpInfo(vec2 worldXZ) {
  vec2 cell = worldXZ / clumpSize;
  vec2 baseCell = floor(cell);

  float minDist = 1e9;
  vec2 bestCellId = vec2(0.0);

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 neighborCell = baseCell + vec2(float(i), float(j));
      vec2 seed = hash2(neighborCell);
      vec2 seedCoord = neighborCell + seed;
      vec2 diff = cell - seedCoord;
      float d2 = dot(diff, diff);

      if (d2 < minDist) {
        minDist = d2;
        bestCellId = neighborCell;
      }
    }
  }

  float distToCenter = sqrt(minDist) * clumpSize;
  return vec3(distToCenter, bestCellId.x, bestCellId.y);
}

vec4 getClumpParams(vec2 cellId) {
  vec2 c1 = hash21(cellId * 11.0);
  vec2 c2 = hash21(cellId * 23.0);

  float clumpBaseHeight = bladeHeight * (0.8 + c1.x * 0.4); // mix(0.8, 1.2, c1.x)
  float clumpBaseWidth = bladeWidth * (0.6 + c1.y * 0.8); // mix(0.6, 1.4, c1.y)
  float clumpBaseBend = bendAmount * (0.7 + c2.x * 0.5); // mix(0.7, 1.2, c2.x)
  float clumpType = floor(c2.y * 3.0);

  return vec4(clumpBaseHeight, clumpBaseWidth, clumpBaseBend, clumpType);
}

vec4 getGrassParams(vec2 seed, vec4 clumpParams) {
  vec2 h1 = hash21(seed * 13.0);
  vec2 h2 = hash21(seed * 29.0);

  float height = clumpParams.x * (0.6 + h1.x * 0.6); // mix(0.6, 1.2, h1.x)
  float width = clumpParams.y * (0.6 + h1.y * 0.6); // mix(0.6, 1.2, h1.y)
  float bend = clumpParams.z * (0.8 + h2.x * 0.4); // mix(0.8, 1.2, h2.x)
  float type = clumpParams.w;

  return vec4(height, width, bend, type);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec4 posData = texture(uPositions, uv); // WebGL2: texture() instead of texture2D()
  vec2 worldXZ = posData.xz;

  // Voronoi clump calculation (matching CPU version exactly)
  vec3 clumpInfo = getClumpInfo(worldXZ);
  float distToCenter = clumpInfo.x;
  vec2 cellId = clumpInfo.yz;
  
  // Calculate clump center world position
  vec2 clumpSeed = hash2(cellId);
  vec2 clumpCenterWorld = (cellId + clumpSeed) * clumpSize;
  
  vec2 dir = clumpCenterWorld - worldXZ;
  float len = length(dir);
  vec2 toCenter = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
  
  float r = clamp(distToCenter / clumpRadius, 0.0, 1.0);
  // smoothstep(0.7, 1.0, r) = 1.0 - smoothstep(0.7, 1.0, r)
  float t = clamp((r - 0.7) / (1.0 - 0.7), 0.0, 1.0);
  float smoothstepVal = t * t * (3.0 - 2.0 * t);
  float presence = 1.0 - smoothstepVal;
  
  vec4 clumpParams = getClumpParams(cellId);
  vec4 bladeParams = getGrassParams(worldXZ, clumpParams);

  // Calculate baseAngle (matching CPU version: Math.atan2(clumpDir[1], clumpDir[0]))
  vec2 clumpDir = toCenter;
  float clumpAngle = atan(clumpDir.y, clumpDir.x);
  float perBladeHash = hash11(dot(worldXZ, vec2(37.0, 17.0)));
  float perBladeHash01 = perBladeHash; // Already in [0, 1] range
  float randomOffset = (perBladeHash - 0.5) * 1.2;
  float clumpHash = hash11(dot(cellId, vec2(9.7, 3.1)));
  float clumpYaw = (clumpHash - 0.5) * 0.25;
  float baseAngle = clumpAngle + randomOffset + clumpYaw;
  
  // Calculate facingAngle01: convert baseAngle from [-π, π] to [0, 1]
  // atan returns [-π, π], normalize to [0, 2π] then to [0, 1]
  float facingAngle = baseAngle;
  if (facingAngle < 0.0) {
    facingAngle += 6.28318530718; // Add 2π if negative
  }
  float facingAngle01 = facingAngle / 6.28318530718; // Normalize to [0, 1]
  
  // Calculate windStrength01: sample wind field using fbm2 (coherent across pipeline)
  float windStrength01 = fbm2(worldXZ * uWindScale, uTime * uWindSpeed); // [0, 1] range
  
  // Calculate lodSeed01: random seed for LOD culling
  float lodSeed01 = hash11(dot(worldXZ, vec2(19.3, 53.7)));

  // Multiple render targets: output to all textures in single pass
  outBladeParams = bladeParams; // height, width, bend, type
  outClumpData = vec4(toCenter.x, toCenter.y, presence, baseAngle); // toCenter.x, toCenter.y, presence, baseAngle
  outMotionSeeds = vec4(facingAngle01, perBladeHash01, windStrength01, lodSeed01); // facingAngle01, perBladeHash01, windStrength01, lodSeed01
}

