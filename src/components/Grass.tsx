import { useMemo, useEffect } from 'react';
import * as THREE from 'three'
import { useControls } from 'leva'
import utility from '@packages/r3f-gist/shaders/cginc/math/utility.glsl'


const GRID_SIZE = 32;
const GRASS_BLADES = GRID_SIZE * GRID_SIZE;
const PATCH_SIZE = 4;
const BLADE_HEIGHT = 0.6;
const BLADE_WIDTH = 0.02;
const BLADE_SEGMENTS = 14;



const grassVertex = /* glsl */ `
  ${utility}

  attribute vec3 instanceOffset;
  uniform float bladeHeight;
  uniform float bladeWidth;
  uniform float bendAmount;

  varying float vHeight;
  varying vec2 vUv;

  // 簡單 hash 當成亂數
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  vec3 bezier2(vec3 p0, vec3 p1, vec3 p2, float t) {
    float u = 1.0 - t;
    return u*u*p0 + 2.0*u*t*p1 + t*t*p2;
  }

  vec3 bezier2Tangent(vec3 p0, vec3 p1, vec3 p2, float t) {
    return 2.0*(1.0 - t)*(p1 - p0) + 2.0*t*(p2 - p1);
  }

  void main() {
    float t = uv.y;
    float s = (uv.x - 0.5) * 2.0; // -1 to 1

    vec3 p0 = vec3(0.0, 0.0, 0.0);
    vec3 p2 = vec3(0.0, bladeHeight, 0.0);
    vec3 p1 = vec3(0.0, bladeHeight * 0.5, bendAmount);
    
    vec3 spine  = bezier2(p0, p1, p2, t);
    vec3 tangent = normalize( bezier2Tangent(p0, p1, p2, t));

    vec3 ref = vec3(1.0, 0.0, 0.0);

    if(abs(dot(tangent, ref)) > 0.95) {
      ref = vec3(0.0, 0.0, 1.0);
    }

    vec3 normal = normalize(cross(tangent, ref));
    vec3 side   = normalize(cross(normal, tangent));
    
    float widthFactor = (1.0 - t);
    vec3 lpos = spine + side * bladeWidth * widthFactor * s;
    
    
    vec2 seed = instanceOffset.xz;
    float perBladeHash = hash(seed * 37.0);
    float randomAngle = perBladeHash * 6.2831;

    lpos.xz = rotate2D(lpos.xz, randomAngle);
    
    vec3 worldPos = lpos + instanceOffset;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);

    vUv = uv;
    vHeight = t;
  }
`;


const grassFragment = /* glsl */ `
  varying float vHeight;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(vUv, 0.0, 1.0);
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

    const { bladeHeight, bladeWidth, bendAmount } = useControls('Grass', {
        bladeHeight: { value: BLADE_HEIGHT, min: 0.1, max: 2.0, step: 0.1 },
        bladeWidth: { value: BLADE_WIDTH, min: 0.01, max: 0.1, step: 0.01 },
        bendAmount: { value: 0.4, min: 0.0, max: 1.0, step: 0.1 },
    })

    const uniforms = useMemo(() => ({
        bladeHeight: { value: bladeHeight },
        bladeWidth: { value: bladeWidth },
        bendAmount: { value: bendAmount },
    }), [])

    useEffect(() => {
        uniforms.bladeHeight.value = bladeHeight
        uniforms.bladeWidth.value = bladeWidth
        uniforms.bendAmount.value = bendAmount
    }, [bladeHeight, bladeWidth, bendAmount, uniforms])

    return (
        <instancedMesh
            args={[geometry, undefined as any, GRASS_BLADES]}
            geometry={geometry}
        >
            <shaderMaterial
                fragmentShader={grassFragment}
                vertexShader={grassVertex}
                uniforms={uniforms}
                side={THREE.DoubleSide}
            />

        </instancedMesh>
    )
}