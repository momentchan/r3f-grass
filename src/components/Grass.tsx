import { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three'
import { useControls } from 'leva'
import CustomShaderMaterial from 'three-custom-shader-material'
import utility from '@packages/r3f-gist/shaders/cginc/math/utility.glsl'


const GRID_SIZE = 64;
const GRASS_BLADES = GRID_SIZE * GRID_SIZE;
const PATCH_SIZE = 8;
const BLADE_HEIGHT = 0.6;
const BLADE_WIDTH = 0.02;
const BLADE_SEGMENTS = 14;



const grassVertex = /* glsl */ `
  ${utility}

  attribute vec3 instanceOffset;
  uniform float bladeHeight;
  uniform float bladeWidth;
  uniform float bendAmount;
  uniform float clumpSize;
  uniform float clumpRadius;

  varying float vHeight;
  varying vec2 vUv;
  varying float vType;
  varying float vPresence;
  varying float vClumpRandom;
  varying vec3 vTest;
  varying vec3 vN;
  varying vec3 vTangent;
  varying vec3 vSide;
  varying vec2 vToCenter;
  varying vec3 vWorldPos;
  
  // Hash functions for per-blade variation
  float hash11(float x) {
    return fract(sin(x * 37.0) * 43758.5453123);
  }

  vec2 hash21(vec2 p) {
    float h1 = hash11(dot(p, vec2(127.1, 311.7)));
    float h2 = hash11(dot(p, vec2(269.5, 183.3)));
    return vec2(h1, h2);
  }

  // 2D hash -> random vec2 in [0,1) for Voronoi seeds
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)),
             dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  // Voronoi-based clump calculation
  // Returns: (distToCenter, cellId.x, cellId.y)
  vec3 getClumpInfo(vec2 worldXZ) {
    // Step 1: Discretize into cells
    vec2 cell = worldXZ / clumpSize;
    vec2 baseCell = floor(cell);
    vec2 cellFrac = fract(cell);

    // Step 2: Find nearest seed in 3x3 neighborhood
    float minDist = 1e9;
    vec2 bestSeedCoord;
    vec2 bestCellId;

    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 neighborCell = baseCell + vec2(float(i), float(j));

        // Random seed offset in this cell
        vec2 seed = neighborCell + hash2(neighborCell);

        // Distance from current position to this seed
        vec2 diff = cell - seed;
        float d2 = dot(diff, diff);

        if (d2 < minDist) {
          minDist = d2;
          bestSeedCoord = seed;
          bestCellId = neighborCell;
        }
      }
    }

    float distToCenter = sqrt(minDist) * clumpSize;
    return vec3(distToCenter, bestCellId);
  }

  // Get clump center world position from cellId
  vec2 getClumpCenterWorld(vec2 cellId) {
    vec2 seedCoord = cellId + hash2(cellId);
    return seedCoord * clumpSize;
  }

  // Grass parameters struct
  struct GrassParams {
    float height;
    float width;
    float bend;
    float tipThin;
    float type;
    float baseWidth;
  };

  // Generate clump-level parameters (per cell)
  // Returns: (baseHeight, baseWidth, baseBend, baseType)
  vec4 getClumpParams(vec2 cellId) {
    vec2 clumpSeed = cellId;
    vec2 c1 = hash21(clumpSeed * 11.0);
    vec2 c2 = hash21(clumpSeed * 23.0);

    float clumpBaseHeight = bladeHeight * mix(0.8, 1.4, c1.x);
    float clumpBaseWidth = bladeWidth * mix(0.8, 1.3, c1.y);
    float clumpBaseBend = bendAmount * mix(0.5, 1.2, c2.x);
    float clumpType = floor(c2.y * 3.0);

    return vec4(clumpBaseHeight, clumpBaseWidth, clumpBaseBend, clumpType);
  }

  // Generate per-blade parameters within clump
  // Takes clump base params and adds small per-blade variation
  GrassParams getGrassParams(vec2 seed, vec4 clumpParams) {
    vec2 h1 = hash21(seed * 13.0);
    vec2 h2 = hash21(seed * 29.0);

    GrassParams gp;

    // Apply clump base params with small per-blade variation
    gp.height = clumpParams.x * mix(0.8, 1.1, h1.x);
    gp.width = clumpParams.y * mix(0.9, 1.1, h1.y);
    gp.bend = clumpParams.z * mix(0.8, 1.2, h2.x);

    // Tip thinness: per-blade variation
    gp.tipThin = mix(0.5, 1.5, h2.y);

    // Use clump type (same type within clump)
    gp.type = clumpParams.w;

    // Base width for width profile calculation
    gp.baseWidth = mix(0.2, 0.5, h1.x);

    return gp;
  }

  // Ghost-style Lighting Normal
  // Computes a lighting normal that blends geometric normal with clump normal
  // for stable, clump-aware lighting that reduces specular noise
  vec3 computeLightingNormal(
    vec3 geoNormal,
    vec2 toCenter,
    float t,
    vec3 worldPos
  ) {
    // Step 1: Clump normal (2.5D, represents clump volume)
    vec3 clumpNormal = normalize(vec3(toCenter.x, 0.7, toCenter.y));
    
    // Step 2: Height weight (base closer to clump normal)
    float heightMask = pow(1.0 - t, 0.7);
    
    // Step 3: Distance weight (farther = more fake normal)
    float dist = length(cameraPosition - worldPos);
    float distMask = smoothstep(4.0, 12.0, dist);
    
    // Step 4: Combine lighting normal
    return normalize(
      mix(
        geoNormal,
        clumpNormal,
        heightMask * distMask
      )
    );
  }

  vec3 bezier2(vec3 p0, vec3 p1, vec3 p2, float t) {
    float u = 1.0 - t;
    return u*u*p0 + 2.0*u*t*p1 + t*t*p2;
  }

  vec3 bezier2Tangent(vec3 p0, vec3 p1, vec3 p2, float t) {
    return 2.0*(1.0 - t)*(p1 - p0) + 2.0*t*(p2 - p1);
  }

  void main() {
    // ============================================
    // 1. UV and Basic Setup
    // ============================================
    float t = uv.y;                    // Height along blade (0 = root, 1 = tip)
    float s = (uv.x - 0.5) * 2.0;     // Width across blade (-1 to 1)
    vec2 worldXZ = instanceOffset.xz;  // World XZ position

    // ============================================
    // 2. Voronoi Clump Calculation
    // ============================================
    vec3 clumpInfo = getClumpInfo(worldXZ);
    float distToCenter = clumpInfo.x;
    vec2 cellId = clumpInfo.yz;
    
    // Get clump center and direction
    vec2 clumpCenterWorld = getClumpCenterWorld(cellId);
    vec2 dir = clumpCenterWorld - worldXZ;
    float len = length(dir);
    vec2 toCenter = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
    
    // Clump profile factors
    float r = clamp(distToCenter / clumpRadius, 0.0, 1.0);
    float heightFactor = mix(1.3, 0.3, r);  // Center high, edge low
    float presence = 1.0 - smoothstep(0.7, 1.0, r);  // Center dense, edge sparse

    // ============================================
    // 3. Grass Parameters (Clump + Per-Blade)
    // ============================================
    vec4 clumpParams = getClumpParams(cellId);
    float clumpRandom = hash11(dot(cellId, vec2(47.0, 61.0)));
    
    vec2 seed = worldXZ;
    GrassParams gp = getGrassParams(seed, clumpParams);
    gp.height *= heightFactor;  // Apply clump height factor
    
    float height = gp.height;
    float width = gp.width;
    float bend = gp.bend;

    // ============================================
    // 4. Bezier Curve Shape Generation
    // ============================================
    vec3 p0 = vec3(0.0, 0.0, 0.0);
    vec3 p2 = vec3(0.0, height, 0.0);
    
    // Different grass types have different bend characteristics
    vec3 p1;
    if (gp.type < 0.5) {
      // Type 0: Straight and sharp, bend in upper-middle section
      p1 = vec3(0.0, height * 0.6, bend * 0.7);
    } else if (gp.type < 1.5) {
      // Type 1: Bend in lower-middle section
      p1 = vec3(0.0, height * 0.3, bend * 1.2);
    } else {
      // Type 2: Bend near the top
      p1 = vec3(0.0, height * 0.8, bend * 1.0);
    }
    
    vec3 spine = bezier2(p0, p1, p2, t);
    vec3 tangent = normalize(bezier2Tangent(p0, p1, p2, t));

    // ============================================
    // 5. TBN Frame Construction (UE-style Derive Normals)
    // ============================================
    vec3 ref = vec3(0.0, 0.0, 1.0);
    vec3 side = normalize(cross(ref, tangent));
    vec3 normal = normalize(cross(side, tangent));
    // ============================================
    // 6. Blade Geometry (Width Profile)
    // ============================================
    float widthFactor = (t + gp.baseWidth) * pow(1.0 - t, gp.tipThin);
    vec3 lpos = spine + side * width * widthFactor * s;
    
    // ============================================
    // 7. Clump-Based Rotation (Optional)
    // ============================================
    // Clump-based rotation: grass blades oriented toward/away from clump center
    vec2 clumpDir = toCenter;
    float clumpAngle = atan(clumpDir.y, clumpDir.x);
    float perBladeHash = hash11(dot(seed, vec2(37.0, 17.0)));
    float randomOffset = (perBladeHash - 0.5) * 0.6;
    float angle = clumpAngle + randomOffset;
    
    // Rotate blade position and TBN frame around Y axis
    lpos.xz = rotate2D(lpos.xz, angle);
    normal.xz = rotate2D(normal.xz, angle);
    
    // ============================================
    // 8. Presence and World Position
    // ============================================
    lpos.xz *= presence;  // Scale down at edges for density control

    vec3 worldPos = lpos + instanceOffset;

    // ============================================
    // 9. CSM Output
    // ============================================
    csm_Position = worldPos;
    // Normal will be computed in fragment shader using csm_FragNormal

    // ============================================
    // 10. Varyings
    // ============================================
    vN = -normal;
    vTangent = tangent;
    vSide = side;
    vToCenter = toCenter;
    vWorldPos = worldPos;
    vTest = normal; // Debug: show geometric normal as color
    vUv = uv;
    vHeight = t;
    vType = gp.type;
    vPresence = presence;
    vClumpRandom = clumpRandom;
  }
`;


const grassFragment = /* glsl */ `
  varying float vHeight;
  varying vec2 vUv;
  varying float vPresence;
  varying float vClumpRandom;
  varying vec3 vTest;
  varying vec3 vN;
  varying vec3 vTangent;
  varying vec3 vSide;
  varying vec2 vToCenter;
  varying vec3 vWorldPos;

  // Compute lighting normal (Ghost-style)
  vec3 computeLightingNormal(
    vec3 geoNormal,
    vec2 toCenter,
    float t,
    vec3 worldPos
  ) {
    // Step 1: Clump normal (2.5D, represents clump volume)
    vec3 clumpNormal = normalize(vec3(toCenter.x, 0.7, toCenter.y));
    
    // Step 2: Height weight (base closer to clump normal)
    float heightMask = pow(1.0 - t, 0.7);
    
    // Step 3: Distance weight (farther = more fake normal)
    float dist = length(cameraPosition - worldPos);
    float distMask = smoothstep(4.0, 12.0, dist);
    
    // Step 4: Combine lighting normal
    return normalize(
      mix(
        geoNormal,
        clumpNormal,
        heightMask * distMask
      )
    );
  }

  void main() {
    // ============================================
    // 1. TBN Frame Construction
    // ============================================
    vec3 T = normalize(vTangent);
    vec3 S = normalize(vSide);
    vec3 baseNormal = normalize(vN);
    
    // ============================================
    // 2. Rim + Midrib effect based on UV.x
    // ============================================
    float u = vUv.x - 0.5;       // [-0.5, 0.5]
    float au = abs(u);          // [0, 0.5]
    
    // Midrib: center area
    float midSoft = 0.2;
    float mid01 = smoothstep(-midSoft, midSoft, u); // 0..1
    
    // Rim: edge fold-back (stronger near 0.5)
    float rimPos = 0.42;
    float rimSoft = 0.2;
    float rimMask = smoothstep(rimPos, rimPos + rimSoft, au);
    
    // Combine: fold back edges (simplified version)
    float v01 =  mix(mid01, 1.0 - mid01, rimMask);
    
    // Remap -> [-1, 1]
    float ny = v01 * 2.0 - 1.0;
    
    // ============================================
    // 3. Apply Rim + Midrib to Normal
    // ============================================
    float widthNormalStrength = 0.35;
    vec3 geoNormal = normalize(baseNormal + S * ny * widthNormalStrength);
    
    // ============================================
    // 4. Compute Lighting Normal (Ghost-style)
    // ============================================
    vec3 lightingNormal = computeLightingNormal(geoNormal, vToCenter, vHeight, vWorldPos);
    
    // ============================================
    // 5. Set CSM Fragment Normal
    // ============================================
    csm_FragNormal = lightingNormal;
    
    // ============================================
    // 6. Color Output
    // ============================================
    // 1. Height gradient
    vec3 baseColor = vec3(0.18, 0.35, 0.12);
    vec3 tipColor = vec3(0.35, 0.65, 0.28);
    vec3 color = mix(baseColor, tipColor, vHeight);

    // 2. AO (Ambient Occlusion)
    float ao = mix(0.4, 1.0, vHeight);
    color *= ao;

    // 3. Clump tint variation
    float clumpTint = mix(0.9, 1.1, vClumpRandom);
    color *= clumpTint;

    // 4. Edge density fade
    color *= vPresence;

    // csm_FragColor = vec4(color, 1.0);
    // csm_FragColor = vec4(vTest, 1.0); // Debug: show normal as color
  }
`;


function createGrassGeometry(): THREE.InstancedBufferGeometry {
    const bladeGeometry = new THREE.PlaneGeometry(
        BLADE_WIDTH,
        BLADE_HEIGHT,
        1,
        BLADE_SEGMENTS
    )

    bladeGeometry.translate(0, BLADE_HEIGHT / 2, 0)

    const instancedGeometry = new THREE.InstancedBufferGeometry()

    // Copy attributes from PlaneGeometry to InstancedBufferGeometry
    instancedGeometry.setAttribute('position', bladeGeometry.attributes.position)
    instancedGeometry.setAttribute('normal', bladeGeometry.attributes.normal)
    instancedGeometry.setAttribute('uv', bladeGeometry.attributes.uv)
    instancedGeometry.setIndex(bladeGeometry.index)

    const offsets = new Float32Array(GRASS_BLADES * 3)
    let i = 0;
    for (let x = 0; x < GRID_SIZE; x++) {
        for (let z = 0; z < GRID_SIZE; z++) {
            const id = x * GRID_SIZE + z;
            if (id >= GRASS_BLADES) break;
            const fx = x / GRID_SIZE - 0.5;
            const fz = z / GRID_SIZE - 0.5;

            const jitterX = (Math.random() - 0.5) * 0.2;
            const jitterZ = (Math.random() - 0.5) * 0.2;

            const px = fx * PATCH_SIZE + jitterX;
            const pz = fz * PATCH_SIZE + jitterZ;

            offsets[i++] = px;
            offsets[i++] = 0;
            offsets[i++] = pz;
        }
    }

    instancedGeometry.setAttribute('instanceOffset', new THREE.InstancedBufferAttribute(offsets, 3))
    return instancedGeometry
}



export default function Grass() {
    const geometry = useMemo(() => createGrassGeometry(), [])

    const { bladeHeight, bladeWidth, bendAmount, clumpSize, clumpRadius } = useControls('Grass', {
        bladeHeight: { value: BLADE_HEIGHT, min: 0.1, max: 2.0, step: 0.1 },
        bladeWidth: { value: BLADE_WIDTH, min: 0.01, max: 0.1, step: 0.01 },
        bendAmount: { value: 0.4, min: 0.0, max: 10.0, step: 0.1 },
        clumpSize: { value: 0.8, min: 0.1, max: 5.0, step: 0.1 },
        clumpRadius: { value: 1.5, min: 0.3, max: 2.0, step: 0.1 },
    })

    const uniforms = useRef({
        bladeHeight: { value: BLADE_HEIGHT },
        bladeWidth: { value: BLADE_WIDTH },
        bendAmount: { value: 0.4 },
        clumpSize: { value: 1.5 },
        clumpRadius: { value: 0.8 },
    }).current

    useEffect(() => {
        uniforms.bladeHeight.value = bladeHeight
        uniforms.bladeWidth.value = bladeWidth
        uniforms.bendAmount.value = bendAmount
        uniforms.clumpSize.value = clumpSize
        uniforms.clumpRadius.value = clumpRadius
    }, [bladeHeight, bladeWidth, bendAmount, clumpSize, clumpRadius])

    return (
        <instancedMesh
            args={[geometry, undefined as any, GRASS_BLADES]}
            geometry={geometry}
        >
            <CustomShaderMaterial
                baseMaterial={THREE.MeshStandardMaterial}
                vertexShader={grassVertex}
                fragmentShader={grassFragment}
                uniforms={uniforms}
                side={THREE.DoubleSide}
            />

        </instancedMesh>
    )
}