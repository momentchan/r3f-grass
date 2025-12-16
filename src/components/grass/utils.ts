// ============================================================================
// Utility Functions
// ============================================================================
import * as THREE from 'three'
import { GRID_SIZE, GRASS_BLADES, PATCH_SIZE, BLADE_SEGMENTS } from './constants'

// ============================================================================
// Seeded Random Number Generator (for consistent position generation)
// ============================================================================
export function seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

export function createGrassGeometry(): THREE.InstancedBufferGeometry {
    const bladeGeometry = new THREE.PlaneGeometry(
        1,
        1,
        1,
        BLADE_SEGMENTS
    )

    bladeGeometry.translate(0, 1 / 2, 0)

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

            const seed = (x * 7919 + z * 7919) * 0.0001;
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

export function createPositionTexture(): THREE.DataTexture {
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
