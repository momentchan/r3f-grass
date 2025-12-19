import * as THREE from 'three'
import { useMemo, useEffect, useRef } from 'react'
import { useControls } from 'leva'
import CustomShaderMaterial from 'three-custom-shader-material'
import { terrainMath } from './terrain/TerrainMath'

const terrainVertex = /* glsl */ `
  ${terrainMath}
  
  void main() {
    // Use xy because mesh is a PlaneGeometry (flat on XY locally)
    vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    float h = getTerrainHeight(worldPos.xz);
    vec3 pos = position;
    pos.z += h; // Displace Z locally (which is Y in world due to rotation)
    
    // Get normal (returns Y-up)
    vec3 n = getTerrainNormal(worldPos.xz);
    
    csm_Position = pos;
    
    // SWIZZLE: Rotate normal to match mesh rotation
    // Local Z is World Y. Local Y is World -Z
    csm_Normal = vec3(n.x, n.y, n.z);
  }
`

const terrainFragment = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    // Simple color mix based on height or slope if desired
    csm_DiffuseColor = vec4(uColor, 1.0);
  }
`

export function Terrain({ onParamsChange }: { onParamsChange?: (params: { amplitude: number; frequency: number; seed: number; color: string }) => void }) {
  const materialRef = useRef<any>(null)

  const terrainParams = useControls('Terrain', {
    amplitude: { value: 2.5, min: 0.1, max: 3.0, step: 0.1 },
    frequency: { value: 0.1, min: 0.01, max: 1.0, step: 0.1 },
    seed: { value: 0.0, min: 0.0, max: 100.0, step: 0.1 },
    color: { value: '#1a3310' }
  }, { collapsed: true })

  // Notify parent of terrain params changes
  useEffect(() => {
    if (onParamsChange) {
      onParamsChange({
        amplitude: terrainParams.amplitude,
        frequency: terrainParams.frequency,
        seed: terrainParams.seed,
        color: terrainParams.color
      })
    }
  }, [terrainParams, onParamsChange])

  const uniforms = useMemo(() => ({
    uColor: { value: new THREE.Color('#1a3310') },
    uTerrainAmp: { value: terrainParams.amplitude },
    uTerrainFreq: { value: terrainParams.frequency },
    uTerrainSeed: { value: terrainParams.seed }
  }), [])

  // Update uniforms when terrainParams change
  useEffect(() => {
    uniforms.uTerrainAmp.value = terrainParams.amplitude
    uniforms.uTerrainFreq.value = terrainParams.frequency
    uniforms.uTerrainSeed.value = terrainParams.seed
    
    // Update color
    const colorVec = new THREE.Color(terrainParams.color)
    uniforms.uColor.value.set(colorVec.r, colorVec.g, colorVec.b)
    
    if (materialRef.current) {
      materialRef.current.needsUpdate = true
    }
  }, [terrainParams, uniforms])

  return (
    // High segment count is needed for smooth FBM terrain
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[20, 20, 200, 200]} />
      <CustomShaderMaterial
        ref={materialRef}
        baseMaterial={THREE.MeshStandardMaterial}
        vertexShader={terrainVertex}
        fragmentShader={terrainFragment}
        uniforms={uniforms}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

