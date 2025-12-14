import { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three'
import { useControls } from 'leva'
import { useFrame, useThree } from '@react-three/fiber'
import CustomShaderMaterial from 'three-custom-shader-material'
import CustomShaderMaterialVanilla from 'three-custom-shader-material/vanilla'
import utility from '@packages/r3f-gist/shaders/cginc/math/utility.glsl'
import fractal from '@packages/r3f-gist/shaders/cginc/noise/fractal.glsl'

// ============================================================================
// Constants
// ============================================================================
const GRID_SIZE = 256;
const GRASS_BLADES = GRID_SIZE * GRID_SIZE;
const PATCH_SIZE = 8;
const BLADE_HEIGHT = 0.6;
const BLADE_WIDTH = 0.02;
const BLADE_SEGMENTS = 14;

// ============================================================================
// GPU Compute Shader (FBO Pass - matching CPU version exactly)
// ============================================================================
const grassComputeShader = /* glsl */ `
  uniform vec2 uResolution;
  uniform sampler2D uPositions; // instanceOffset positions
  uniform float bladeHeight;
  uniform float bladeWidth;
  uniform float bendAmount;
  uniform float clumpSize;
  uniform float clumpRadius;
  
  // Multiple render targets output declarations (WebGL2/GLSL ES 3.00)
  layout(location = 0) out vec4 fragColor0; // bladeParams: height, width, bend, type
  layout(location = 1) out vec4 fragColor1; // clumpData: toCenter.x, toCenter.y, presence, baseAngle

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
    float randomOffset = (perBladeHash - 0.5) * 1.2;
    float clumpYaw = (hash11(dot(cellId, vec2(9.7, 3.1))) - 0.5) * 0.25;
    float baseAngle = clumpAngle + randomOffset + clumpYaw;

    // Multiple render targets: output to both textures in single pass
    fragColor0 = bladeParams; // height, width, bend, type
    fragColor1 = vec4(toCenter.x, toCenter.y, presence, baseAngle); // toCenter.x, toCenter.y, presence, baseAngle
  }
`;

// ============================================================================
// Vertex Shader
// ============================================================================
const grassVertex = /* glsl */ `
  ${utility}
  ${fractal}

  // ============================================================================
  // Attributes & Uniforms
  // ============================================================================
  attribute vec3 instanceOffset;
  attribute float instanceId; // instance index for texture lookup
  uniform sampler2D uBladeParamsTexture; // FBO texture with blade params
  uniform sampler2D uClumpDataTexture; // FBO texture with clump data
  uniform vec2 uGrassTextureSize; // texture resolution (GRID_SIZE)
  
  #define GRID_SIZE 256.0
  #define PATCH_SIZE 8.0
  
  uniform float thicknessStrength;
  
  // Wind uniforms
  uniform float uTime;
  uniform vec2 uWindDir;
  uniform float uWindSpeed;
  uniform float uWindStrength;
  uniform float uWindScale;

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

  // Returns wind scalar [0..1] - simplified version
  float sampleWind(vec2 worldXZ) {
    float n = fbm2(worldXZ * uWindScale, uTime * uWindSpeed);
    return n;
  }

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

    // 2. Calculate texture coordinates from instance ID
    float id = instanceId;
    vec2 texCoord = vec2(
      mod(id, uGrassTextureSize.x) / uGrassTextureSize.x,
      floor(id / uGrassTextureSize.x) / uGrassTextureSize.y
    );

    // 3. Read Precomputed Data from FBO textures using texelFetch
    ivec2 texelCoord = ivec2(floor(texCoord * uGrassTextureSize));
    vec4 bladeParams = texelFetch(uBladeParamsTexture, texelCoord, 0);
    vec4 clumpData = texelFetch(uClumpDataTexture, texelCoord, 0);
    
    vec2 toCenter = clumpData.xy;
    float presence = clumpData.z;
    float baseAngle = clumpData.w;

    float height = bladeParams.x;
    float width = bladeParams.y;
    float bend = bladeParams.z;
    float bladeType = bladeParams.w;

    // 3. Wind Field Sampling (simplified - can be optimized further)
    float wind = sampleWind(worldXZ);
    
    // Simplified wind calculation (can be enhanced later)
    float windS = (wind * 2.0 - 1.0) * uWindStrength;
    
    // Wind affects blade facing (low frequency)
    float windAngle = atan(uWindDir.y, uWindDir.x);
    float windFacing = (wind * 2.0 - 1.0) * 0.35 * uWindStrength;
    float anglePre = mix(baseAngle, windAngle, 0.25 * uWindStrength) + windFacing;
    
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
    
    // Bobbing phase (high frequency sway) - simplified
    float phase = hash11(worldXZ.x * 12.3 + worldXZ.y * 78.9) * 6.28318;
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
`;

// ============================================================================
// Fragment Shader
// ============================================================================
const grassFragment = /* glsl */ `
  uniform vec3 baseColor;
  uniform vec3 tipColor;
  
  varying float vHeight;
  varying vec2 vUv;
  varying float vPresence;
  varying vec3 vTest;
  varying vec3 vN;
  varying vec3 vTangent;
  varying vec3 vSide;
  varying vec2 vToCenter;
  varying vec3 vWorldPos;

  // ============================================================================
  // Lighting Normal Computation (Ghost-style)
  // ============================================================================
  vec3 computeLightingNormal(
    vec3 geoNormal,
    vec2 toCenter,
    float t,
    vec3 worldPos
  ) {
    vec3 clumpNormal = normalize(vec3(toCenter.x, 0.7, toCenter.y));
    float heightMask = pow(1.0 - t, 0.7);
    float dist = length(cameraPosition - worldPos);
    float distMask = smoothstep(4.0, 12.0, dist);
    
    return normalize(
      mix(
        geoNormal,
        clumpNormal,
        heightMask * distMask
      )
    );
  }

  // ============================================================================
  // Main Fragment Shader
  // ============================================================================
  void main() {
    // 1. TBN Frame Construction
    vec3 T = normalize(vTangent);
    vec3 S = normalize(vSide);
    vec3 baseNormal = normalize(vN);
    
    // 2. Rim + Midrib Effect
    float u = vUv.x - 0.5;
    float au = abs(u);
    
    float midSoft = 0.2;
    float mid01 = smoothstep(-midSoft, midSoft, u);
    
    float rimPos = 0.42;
    float rimSoft = 0.2;
    float rimMask = smoothstep(rimPos, rimPos + rimSoft, au);
    
    float v01 = mix(mid01, 1.0 - mid01, rimMask);
    float ny = v01 * 2.0 - 1.0;
    
    // 3. Apply Rim + Midrib to Normal
    float widthNormalStrength = 0.35;
    vec3 geoNormal = normalize(baseNormal + S * ny * widthNormalStrength);
    
    // 4. Compute Lighting Normal
    vec3 lightingNormal = computeLightingNormal(geoNormal, vToCenter, vHeight, vWorldPos);
    
    // 5. Set CSM Fragment Normal
    csm_FragNormal = lightingNormal;
    
    // 6. Color Output
    vec3 color = mix(baseColor, tipColor, vHeight);

    float ao = mix(0.4, 1.0, vHeight);
    // color *= ao;

    // Removed seed-based tint (can be restored if needed)

    // color *= vPresence;

    csm_DiffuseColor = vec4(color, 1.0);
    // csm_FragColor = vec4(color, 1.0);
    // csm_FragColor = vec4(vHeight, 0.0, 0.0, 1.0);
  }
`;

// ============================================================================
// Seeded Random Number Generator (for consistent position generation)
// ============================================================================
function seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

// ============================================================================
// Geometry Creation (simplified - only positions and instance IDs)
// ============================================================================
function createGrassGeometry(): THREE.InstancedBufferGeometry {
    const bladeGeometry = new THREE.PlaneGeometry(
        BLADE_WIDTH,
        BLADE_HEIGHT,
        1,
        BLADE_SEGMENTS
    )

    bladeGeometry.translate(0, BLADE_HEIGHT / 2, 0)

    const instancedGeometry = new THREE.InstancedBufferGeometry()

    instancedGeometry.setAttribute('position', bladeGeometry.attributes.position)
    instancedGeometry.setAttribute('normal', bladeGeometry.attributes.normal)
    instancedGeometry.setAttribute('uv', bladeGeometry.attributes.uv)
    instancedGeometry.setIndex(bladeGeometry.index)

    const offsets = new Float32Array(GRASS_BLADES * 3)
    const instanceIds = new Float32Array(GRASS_BLADES)

    let i = 0;
    let idIdx = 0;

    for (let x = 0; x < GRID_SIZE; x++) {
        for (let z = 0; z < GRID_SIZE; z++) {
            const id = x * GRID_SIZE + z;
            if (id >= GRASS_BLADES) break;
            const fx = x / GRID_SIZE - 0.5;
            const fz = z / GRID_SIZE - 0.5;

            // Use seeded random for consistency with position texture
            const seed = (x * 7919 + z * 7919) * 0.0001; // Prime numbers for better distribution
            const jitterX = (seededRandom(seed) - 0.5) * 0.2;
            const jitterZ = (seededRandom(seed + 1.0) - 0.5) * 0.2;

            const px = fx * PATCH_SIZE + jitterX;
            const pz = fz * PATCH_SIZE + jitterZ;

            offsets[i++] = px;
            offsets[i++] = 0;
            offsets[i++] = pz;

            instanceIds[idIdx++] = id;
        }
    }

    instancedGeometry.setAttribute('instanceOffset', new THREE.InstancedBufferAttribute(offsets, 3))
    instancedGeometry.setAttribute('instanceId', new THREE.InstancedBufferAttribute(instanceIds, 1))
    
    return instancedGeometry
}

// ============================================================================
// FBO Compute Setup
// ============================================================================
function createPositionTexture(): THREE.DataTexture {
    const data = new Float32Array(GRID_SIZE * GRID_SIZE * 4)
    let idx = 0
    
    for (let x = 0; x < GRID_SIZE; x++) {
        for (let z = 0; z < GRID_SIZE; z++) {
            const fx = x / GRID_SIZE - 0.5
            const fz = z / GRID_SIZE - 0.5
            
            // Use same seeded random as geometry creation for consistency
            const seed = (x * 7919 + z * 7919) * 0.0001
            const jitterX = (seededRandom(seed) - 0.5) * 0.2
            const jitterZ = (seededRandom(seed + 1.0) - 0.5) * 0.2
            
            const px = fx * PATCH_SIZE + jitterX
            const pz = fz * PATCH_SIZE + jitterZ
            
            data[idx++] = px
            data[idx++] = 0
            data[idx++] = pz
            data[idx++] = 0
        }
    }
    
    const texture = new THREE.DataTexture(data, GRID_SIZE, GRID_SIZE, THREE.RGBAFormat, THREE.FloatType)
    texture.needsUpdate = true
    return texture
}

// ============================================================================
// Component
// ============================================================================
export default function Grass() {
    const { bladeHeight, bladeWidth, bendAmount, clumpSize, clumpRadius, thicknessStrength, baseColor, tipColor } = useControls('Grass', {
        bladeHeight: { value: BLADE_HEIGHT, min: 0.1, max: 2.0, step: 0.1 },
        bladeWidth: { value: BLADE_WIDTH, min: 0.01, max: 0.1, step: 0.01 },
        bendAmount: { value: 0.4, min: 0.0, max: 10.0, step: 0.1 },
        clumpSize: { value: 0.8, min: 0.1, max: 5.0, step: 0.1 },
        clumpRadius: { value: 1.5, min: 0.3, max: 2.0, step: 0.1 },
        thicknessStrength: { value: 0.02, min: 0.0, max: 0.1, step: 0.001 },
        tipColor: { value: '#3e8d2f', label: 'Tip Color' },
        baseColor: { value: '#213110', label: 'Base Color' },
    })

    const gl = useThree((state) => state.gl)
    const geometry = useMemo(() => createGrassGeometry(), [])

    // Create position texture
    const positionTexture = useMemo(() => createPositionTexture(), [])

    // Create multiple render targets for compute pass (single pass, multiple outputs)
    const mrt = useMemo(() => {
        const renderTarget = new THREE.WebGLRenderTarget(GRID_SIZE, GRID_SIZE, {
            count: 2, // Multiple render targets
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
        })
        
        return renderTarget
    }, [])
    
    const bladeParamsRT = useMemo(() => ({ texture: mrt.textures[0] }), [mrt])
    const clumpDataRT = useMemo(() => ({ texture: mrt.textures[1] }), [mrt])

    const grassComputeMat = useMemo(() => new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3, // Enable WebGL2/GLSL ES 3.00 for Multiple Render Targets
        vertexShader: `
            void main() {
                gl_Position = vec4(position, 1.0);
            }
        `,
        fragmentShader: grassComputeShader,
        uniforms: {
            uResolution: { value: new THREE.Vector2(GRID_SIZE, GRID_SIZE) },
            uPositions: { value: positionTexture },
            bladeHeight: { value: bladeHeight },
            bladeWidth: { value: bladeWidth },
            bendAmount: { value: bendAmount },
            clumpSize: { value: clumpSize },
            clumpRadius: { value: clumpRadius },
        }
    }), [positionTexture, bladeHeight, bladeWidth, bendAmount, clumpSize, clumpRadius])

    // Create fullscreen quad for compute pass
    const computeScene = useMemo(() => {
        const scene = new THREE.Scene()
        const geometry = new THREE.PlaneGeometry(2, 2)
        scene.add(new THREE.Mesh(geometry, grassComputeMat))
        return scene
    }, [grassComputeMat])

    const computeCamera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), [])

    const materialRef = useRef<any>(null)

    const materialControls = useControls('Material', {
        roughness: { value: 0.3, min: 0.0, max: 1.0, step: 0.01 },
        metalness: { value: 0.5, min: 0.0, max: 1.0, step: 0.01 },
        emissive: { value: '#000000', label: 'Emissive Color' },
        emissiveIntensity: { value: 0.0, min: 0.0, max: 2.0, step: 0.1 },
        envMapIntensity: { value: 1.0, min: 0.0, max: 3.0, step: 0.1 },
    })

    const wind = useControls('Wind', {
        dirX: { value: 1, min: -1, max: 1, step: 0.01 },
        dirZ: { value: 0, min: -1, max: 1, step: 0.01 },
        speed: { value: 0.6, min: 0, max: 3, step: 0.01 },
        strength: { value: 0.35, min: 0, max: 2, step: 0.01 },
        scale: { value: 0.25, min: 0.01, max: 2, step: 0.01 },
    })

    const emissiveColor = useMemo(() => new THREE.Color(materialControls.emissive as any), [materialControls.emissive])

    const uniforms = useRef({
        thicknessStrength: { value: 0.02 },
        baseColor: { value: new THREE.Vector3(0.18, 0.35, 0.12) },
        tipColor: { value: new THREE.Vector3(0.35, 0.65, 0.28) },
        // Multiple render target textures
        uBladeParamsTexture: { value: bladeParamsRT.texture },
        uClumpDataTexture: { value: clumpDataRT.texture },
        uGrassTextureSize: { value: new THREE.Vector2(GRID_SIZE, GRID_SIZE) },
        // Wind uniforms
        uTime: { value: 0 },
        uWindDir: { value: new THREE.Vector2(1, 0) },
        uWindSpeed: { value: 0.6 },
        uWindStrength: { value: 0.35 },
        uWindScale: { value: 0.25 },
    }).current

    // Update texture uniforms when render targets change
    useEffect(() => {
        uniforms.uBladeParamsTexture.value = bladeParamsRT.texture
        uniforms.uClumpDataTexture.value = clumpDataRT.texture
    }, [bladeParamsRT.texture, clumpDataRT.texture, uniforms])

    // Create depth material for directional/spot light shadows
    const depthMat = useMemo(() => {
        // Replace csm_Position with transformed for shadow pass

        const m = new CustomShaderMaterialVanilla({
            baseMaterial: THREE.MeshDepthMaterial,
            vertexShader: grassVertex,
            uniforms: uniforms,
            depthPacking: THREE.RGBADepthPacking,
        })

        // Important: depthMat doesn't need DoubleSide unless you really want double-sided shadows
        // m.side = THREE.DoubleSide;

        return m
    }, [uniforms])

    useEffect(() => {
        uniforms.thicknessStrength.value = thicknessStrength
        
        // Convert Leva color (string or object) to Vector3
        const baseColorVec = new THREE.Color(baseColor as any)
        uniforms.baseColor.value.set(baseColorVec.r, baseColorVec.g, baseColorVec.b)
        
        const tipColorVec = new THREE.Color(tipColor as any)
        uniforms.tipColor.value.set(tipColorVec.r, tipColorVec.g, tipColorVec.b)
        
        // Update wind uniforms
        const windDir = new THREE.Vector2(wind.dirX, wind.dirZ).normalize()
        uniforms.uWindDir.value.set(windDir.x, windDir.y)
        uniforms.uWindSpeed.value = wind.speed
        uniforms.uWindStrength.value = wind.strength
        uniforms.uWindScale.value = wind.scale
        
        // Trigger shadow material to recompile when uniforms change
        depthMat.needsUpdate = true
    }, [thicknessStrength, baseColor, tipColor, wind, depthMat])

    // Initialize compute pass once
    useEffect(() => {
        const currentRenderTarget = gl.getRenderTarget()
        
        // Render to multiple render targets in single pass
        gl.setRenderTarget(mrt)
        gl.render(computeScene, computeCamera)
        
        // Restore render target
        gl.setRenderTarget(currentRenderTarget)
    }, [gl, mrt, computeScene, computeCamera, grassComputeMat])

    // Update time every frame and execute compute pass
    useFrame((state) => {
        uniforms.uTime.value = state.clock.elapsedTime
        
        // Execute compute pass (single pass, multiple outputs)
        const currentRenderTarget = gl.getRenderTarget()
        
        // Render to multiple render targets in single pass
        gl.setRenderTarget(mrt)
        gl.render(computeScene, computeCamera)
        
        // Restore render target
        gl.setRenderTarget(currentRenderTarget)
    })


    return (
        <instancedMesh
            args={[geometry, undefined as any, GRASS_BLADES]}
            geometry={geometry}
            // castShadow
            // receiveShadow
            customDepthMaterial={depthMat}
        >
            <CustomShaderMaterial
                ref={materialRef}
                baseMaterial={THREE.MeshStandardMaterial}
                vertexShader={grassVertex}
                fragmentShader={grassFragment}
                uniforms={uniforms}
                side={THREE.DoubleSide}
                roughness={materialControls.roughness}
                metalness={materialControls.metalness}
                emissive={emissiveColor}
                emissiveIntensity={materialControls.emissiveIntensity}
                envMapIntensity={materialControls.envMapIntensity}
            />
        </instancedMesh>
    )
}
