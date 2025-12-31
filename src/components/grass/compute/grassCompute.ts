import { Fn, vec2, fract, sin, mul, dot, mix, sub, add, instancedArray, instanceIndex, uniform } from 'three/tsl';
import * as THREE from 'three';

/**
 * Creates a grass compute function that calculates blade parameters based on position
 * Matches the logic from grassComputeShader.glsl getBladeParams function
 * Returns the compute function and uniform nodes for updating values
 */
export function createGrassCompute(
  grassData: ReturnType<typeof instancedArray>,
  positions: ReturnType<typeof instancedArray>,
  initialValues?: {
    bladeHeightMin?: number;
    bladeHeightMax?: number;
    bladeWidthMin?: number;
    bladeWidthMax?: number;
    bendAmountMin?: number;
    bendAmountMax?: number;
    bladeRandomness?: { x: number; y: number; z: number };
  }
) {
  // Shape Parameters - matching grassComputeShader.glsl
  // Create uniforms with initial values (like the birds example: uniform(15.0).setName('separation'))
  const uBladeHeightMin = uniform(initialValues?.bladeHeightMin ?? 0.4).setName('uBladeHeightMin');
  const uBladeHeightMax = uniform(initialValues?.bladeHeightMax ?? 0.8).setName('uBladeHeightMax');
  const uBladeWidthMin = uniform(initialValues?.bladeWidthMin ?? 0.01).setName('uBladeWidthMin');
  const uBladeWidthMax = uniform(initialValues?.bladeWidthMax ?? 0.05).setName('uBladeWidthMax');
  const uBendAmountMin = uniform(initialValues?.bendAmountMin ?? 0.2).setName('uBendAmountMin');
  const uBendAmountMax = uniform(initialValues?.bendAmountMax ?? 0.6).setName('uBendAmountMax');
  
  // Blade Randomness - matching grassComputeShader.glsl
  const bladeRandomness = initialValues?.bladeRandomness ?? { x: 0.3, y: 0.3, z: 0.2 };
  const uBladeRandomness = uniform(new THREE.Vector3(bladeRandomness.x, bladeRandomness.y, bladeRandomness.z)).setName('uBladeRandomness');

  const computeFn = Fn(() => {

    // Hash function hash11 - matches compute shader
    // hash11(x) = fract(sin(x * 37.0) * 43758.5453123)
    // Inline implementation since TSL doesn't support nested Fn() definitions
    const hash11 = (x: any) => fract(mul(sin(mul(x, 37.0)), 43758.5453123));

    // Hash function hash21 - matches compute shader
    // hash21(p) = vec2(hash11(dot(p, vec2(127.1, 311.7))), hash11(dot(p, vec2(269.5, 183.3))))
    const hash21 = (p: any) => {
      const h1 = hash11(dot(p, vec2(127.1, 311.7)));
      const h2 = hash11(dot(p, vec2(269.5, 183.3)));
      return vec2(h1, h2);
    };

    const data = grassData.element(instanceIndex);
    const instancePos = positions.element(instanceIndex);
    
    // Get worldXZ position (x and z components)
    const worldXZ = vec2(instancePos.x, instancePos.z);
    
    // Simplified clump params calculation (using worldXZ as cellId for now)
    const cellId = worldXZ;
    const c1 = hash21(mul(cellId, 11.0));
    const c2 = hash21(mul(cellId, 23.0));
    
    // Calculate clump base parameters using uniforms
    const clumpBaseHeight = mix(uBladeHeightMin, uBladeHeightMax, c1.x);
    const clumpBaseWidth = mix(uBladeWidthMin, uBladeWidthMax, c1.y);
    const clumpBaseBend = mix(uBendAmountMin, uBendAmountMax, c2.x);
    const clumpType = 0.5; // Simplified - would use noise in full implementation
    
    // Calculate per-blade parameters (matching getBladeParams from compute shader)
    const seed = worldXZ;
    const h1 = hash21(mul(seed, 13.0));
    const h2 = hash21(mul(seed, 29.0));
    
    // Calculate blade params with randomness using uniforms
    const height = mul(clumpBaseHeight, mix(sub(1.0, uBladeRandomness.x), add(1.0, uBladeRandomness.x), h1.x));
    const width = mul(clumpBaseWidth, mix(sub(1.0, uBladeRandomness.y), add(1.0, uBladeRandomness.y), h1.y));
    const bend = mul(clumpBaseBend, mix(sub(1.0, uBladeRandomness.z), add(1.0, uBladeRandomness.z), h2.x));
    const type = clumpType;
    
    // Write blade parameters back to data structure
    data.get('bladeHeight').assign(height);
    data.get('bladeWidth').assign(width);
    data.get('bladeBend').assign(bend);
    data.get('bladeType').assign(type);
  });

  return {
    computeFn,
    uniforms: {
      uBladeHeightMin,
      uBladeHeightMax,
      uBladeWidthMin,
      uBladeWidthMax,
      uBendAmountMin,
      uBendAmountMax,
      uBladeRandomness,
    },
  };
}

