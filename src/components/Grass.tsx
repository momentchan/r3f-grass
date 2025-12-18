import { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three'
import { useControls, folder } from 'leva'
import { useFrame, useThree } from '@react-three/fiber'
import CustomShaderMaterial from 'three-custom-shader-material'
import CustomShaderMaterialVanilla from 'three-custom-shader-material/vanilla'
import utility from '@packages/r3f-gist/shaders/cginc/math/utility.glsl'
import fractal from '@packages/r3f-gist/shaders/cginc/noise/fractal.glsl'
import { GRID_SIZE, GRASS_BLADES } from './grass/constants'
import { createGrassGeometry } from './grass/utils'
import { useGrassCompute } from './grass/hooks/useGrassCompute'
import grassVertexShader from './grass/shaders/grassVertex.glsl?raw'
import grassFragmentShader from './grass/shaders/grassFragment.glsl?raw'

const grassVertex = /* glsl */ `
  ${utility}
  ${fractal}
  ${grassVertexShader}
`
const grassFragment = grassFragmentShader

export default function Grass() {
  const { scene } = useThree()

  const [computeParams] = useControls('Grass.Compute', () => ({
    Shape: folder({
      bladeHeightMin: { value: 0.4, min: 0.1, max: 2.0, step: 0.1 },
      bladeHeightMax: { value: 0.8, min: 0.1, max: 2.0, step: 0.1 },
      bladeWidthMin: { value: 0.01, min: 0.01, max: 0.1, step: 0.001 },
      bladeWidthMax: { value: 0.05, min: 0.01, max: 0.1, step: 0.001 },
      bendAmountMin: { value: 0.2, min: 0.0, max: 1.0, step: 0.1 },
      bendAmountMax: { value: 0.6, min: 0.0, max: 1.0, step: 0.1 },
      bladeRandomness: { value: { x: 0.3, y: 0.3, z: 0.2 }, step: 0.01, min: 0.0, max: 1.0 },
      baseWidth: { value: 0.35, min: 0.0, max: 1.0, step: 0.01 },
      tipThin: { value: 0.9, min: 0.0, max: 2.0, step: 0.01 },
    }, { collapsed: true }),
    Clump: folder({
      clumpSize: { value: 0.8, min: 0.1, max: 5.0, step: 0.1 },
      clumpRadius: { value: 1.5, min: 0.3, max: 2.0, step: 0.1 },
    }, { collapsed: true }),
    Angle: folder({
      centerYaw: { value: 1.0, min: 0.0, max: 3.0, step: 0.1 },
      bladeYaw: { value: 1.2, min: 0.0, max: 3.0, step: 0.1 },
      clumpYaw: { value: 0.5, min: 0.0, max: 2.0, step: 0.1 },
    }, { collapsed: true }),
    Wind: folder({
      windDirX: { value: 1, min: -1, max: 1, step: 0.01 },
      windDirZ: { value: 0, min: -1, max: 1, step: 0.01 },
      windSpeed: { value: 0.6, min: 0, max: 3, step: 0.01 },
      windStrength: { value: 0.35, min: 0, max: 2, step: 0.01 },
      windScale: { value: 0.25, min: 0.01, max: 2, step: 0.01 },
      windFacing: { value: 0.6, min: 0.0, max: 1.0, step: 0.01 },
      swayFreqMin: { value: 1.0, min: 0.1, max: 10.0, step: 0.1 },
      swayFreqMax: { value: 2.2, min: 0.1, max: 10.0, step: 0.1 },
      swayStrength: { value: 0.1, min: 0.0, max: 0.5, step: 0.001 },
    }, { collapsed: true }),
  }))

  // LOD controls
  const [lodControls] = useControls('Grass.LOD', () => ({
    lodStart: { value: 5, min: 0, max: 50, step: 1 },
    lodEnd: { value: 15, min: 0, max: 50, step: 1 },
  }))

  // Vertex/Fragment shader parameters
  const [renderingParams] = useControls('Grass.Rendering', () => ({
    Geometry: folder({
      thicknessStrength: { value: 0.02, min: 0.0, max: 0.1, step: 0.001 },
    }, { collapsed: true }),
    Color: folder({
      baseColor: { value: '#213110' },
      tipColor: { value: '#3e8d2f' },
    }, { collapsed: true }),
    Normal: folder({
      midSoft: { value: 0.25, min: 0.0, max: 1.0, step: 0.01 },
      rimPos: { value: 0.42, min: 0.0, max: 1.0, step: 0.01 },
      rimSoft: { value: 0.03, min: 0.0, max: 0.1, step: 0.001 },
    }, { collapsed: true }),
    Lighting: folder({
      backLightStrength: { value: 0.2, min: 0.0, max: 2.0, step: 0.1 },
    }, { collapsed: true }),
    ColorVariation: folder({
      bladeSeedRange: { value: { x: 0.95, y: 1.03 }, step: 0.01, min: 0.5, max: 1.5 },
      clumpInternalRange: { value: { x: 0.95, y: 1.05 }, step: 0.01, min: 0.5, max: 1.5 },
      clumpSeedRange: { value: { x: 0.9, y: 1.1 }, step: 0.01, min: 0.5, max: 1.5 },
      aoPower: { value: 2, min: 0.1, max: 5.0, step: 0.1 },
    }, { collapsed: true }),
  }))

  const geometry = useMemo(() => createGrassGeometry(), [])

  const materialRef = useRef<any>(null)

  const materialControls = useControls('Grass.Material', {
    roughness: { value: 0.3, min: 0.0, max: 1.0, step: 0.01 },
    metalness: { value: 0.5, min: 0.0, max: 1.0, step: 0.01 },
    emissive: { value: '#000000', label: 'Emissive Color' },
    emissiveIntensity: { value: 0.0, min: 0.0, max: 2.0, step: 0.1 },
    envMapIntensity: { value: 1.0, min: 0.0, max: 3.0, step: 0.1 },
  })

  const emissiveColor = useMemo(() => new THREE.Color(materialControls.emissive as any), [materialControls.emissive])

  // Use grass compute hook for Multiple Render Targets (before uniforms definition)
  const bladeRandomnessVec = useMemo(() => {
    const r = computeParams.bladeRandomness as any
    return new THREE.Vector3(r.x, r.y, r.z)
  }, [computeParams.bladeRandomness])

  const windDirVec = useMemo(() => {
    const dir = new THREE.Vector2(computeParams.windDirX, computeParams.windDirZ).normalize()
    return dir
  }, [computeParams.windDirX, computeParams.windDirZ])

  const computeConfig = useMemo(() => ({
    bladeHeightMin: computeParams.bladeHeightMin,
    bladeHeightMax: computeParams.bladeHeightMax,
    bladeWidthMin: computeParams.bladeWidthMin,
    bladeWidthMax: computeParams.bladeWidthMax,
    bendAmountMin: computeParams.bendAmountMin,
    bendAmountMax: computeParams.bendAmountMax,
    clumpSize: computeParams.clumpSize,
    clumpRadius: computeParams.clumpRadius,
    uCenterYaw: computeParams.centerYaw,
    uBladeYaw: computeParams.bladeYaw,
    uClumpYaw: computeParams.clumpYaw,
    uBladeRandomness: bladeRandomnessVec,
    uTime: 0.0, // Initial value, updated in useFrame
    uWindScale: computeParams.windScale,
    uWindSpeed: computeParams.windSpeed,
    uWindDir: windDirVec,
    uWindFacing: computeParams.windFacing,
  }), [computeParams, bladeRandomnessVec, windDirVec])

  const { bladeParamsRT, clumpDataRT, additionalDataRT, computeMaterial, compute } = useGrassCompute(computeConfig)

  const uniforms = useRef({
    thicknessStrength: { value: 0.02 },
    baseColor: { value: new THREE.Vector3(0.18, 0.35, 0.12) },
    tipColor: { value: new THREE.Vector3(0.35, 0.65, 0.28) },
    uMidSoft: { value: 0.2 },
    uRimPos: { value: 0.42 },
    uRimSoft: { value: 0.2 },
    uLightDirection: { value: new THREE.Vector3(0, 0, -1) },
    uLightColor: { value: new THREE.Vector3(1, 1, 1) },
    uBackLightStrength: { value: 0.6 },
    uBladeSeedRange: { value: new THREE.Vector2(0.95, 1.03) },
    uClumpInternalRange: { value: new THREE.Vector2(0.95, 1.05) },
    uClumpSeedRange: { value: new THREE.Vector2(0.9, 1.1) },
    uAOPower: { value: 0.6 },
    // Multiple render target textures
    uBladeParamsTexture: { value: bladeParamsRT.texture },
    uClumpDataTexture: { value: clumpDataRT.texture },
    uMotionSeedsTexture: { value: additionalDataRT.texture },
    uGrassTextureSize: { value: new THREE.Vector2(GRID_SIZE, GRID_SIZE) },
    // Wind uniforms
    uTime: { value: 0 },
    uWindStrength: { value: 0.35 }, // Still needed for scaling wind effects in vertex shader
    uWindDir: { value: new THREE.Vector2(1, 0) }, // Wind direction for sway direction
    uSwayFreqMin: { value: 1.0 }, // Minimum frequency for wind sway animation
    uSwayFreqMax: { value: 2.2 }, // Maximum frequency for wind sway animation
    uSwayStrength: { value: 1.0 }, // Sway strength multiplier for wind animation
    uBaseWidth: { value: 0.35 }, // Base width factor for blade geometry
    uTipThin: { value: 0.9 }, // Tip thinning factor for blade geometry
    uLODRange: { value: new THREE.Vector2(15, 40) }, // LOD range: x = start fold distance, y = full fold distance
    // Note: uWindSpeed is only used in compute shader for wind field translation
  }).current

  // Update texture uniforms when render targets change
  useEffect(() => {
    uniforms.uBladeParamsTexture.value = bladeParamsRT.texture
    uniforms.uClumpDataTexture.value = clumpDataRT.texture
    uniforms.uMotionSeedsTexture.value = additionalDataRT.texture
  }, [bladeParamsRT.texture, clumpDataRT.texture, additionalDataRT.texture, uniforms])

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
    const params = renderingParams as any
    
    uniforms.thicknessStrength.value = params.thicknessStrength

    // Convert Leva color (string or object) to Vector3
    const baseColorVec = new THREE.Color(params.baseColor)
    uniforms.baseColor.value.set(baseColorVec.r, baseColorVec.g, baseColorVec.b)

    const tipColorVec = new THREE.Color(params.tipColor)
    uniforms.tipColor.value.set(tipColorVec.r, tipColorVec.g, tipColorVec.b)

    // Update rim and midrib parameters
    uniforms.uMidSoft.value = params.midSoft
    uniforms.uRimPos.value = params.rimPos
    uniforms.uRimSoft.value = params.rimSoft
    uniforms.uBackLightStrength.value = params.backLightStrength
    
    // Update color layer ranges
    const bladeSeedRange = params.bladeSeedRange
    uniforms.uBladeSeedRange.value.set(bladeSeedRange.x, bladeSeedRange.y)
    
    const clumpInternalRange = params.clumpInternalRange
    uniforms.uClumpInternalRange.value.set(clumpInternalRange.x, clumpInternalRange.y)
    
    const clumpSeedRange = params.clumpSeedRange
    uniforms.uClumpSeedRange.value.set(clumpSeedRange.x, clumpSeedRange.y)
    
    // Update AO power
    uniforms.uAOPower.value = params.aoPower

    // Update wind uniforms
    uniforms.uWindStrength.value = computeParams.windStrength
    uniforms.uWindDir.value.set(windDirVec.x, windDirVec.y)
    uniforms.uSwayFreqMin.value = computeParams.swayFreqMin
    uniforms.uSwayFreqMax.value = computeParams.swayFreqMax
    uniforms.uSwayStrength.value = computeParams.swayStrength
    uniforms.uBaseWidth.value = computeParams.baseWidth
    uniforms.uTipThin.value = computeParams.tipThin
    // Note: uWindSpeed is only updated in compute shader

    // Trigger shadow material to recompile when uniforms change
    depthMat.needsUpdate = true
  }, [renderingParams, computeParams, windDirVec, depthMat])

  // Set envMap from scene
  useEffect(() => {
    if (materialRef.current && scene.environment) {
      materialRef.current.envMap = scene.environment
      materialRef.current.needsUpdate = true
    }
  }, [scene.environment])

  // Update time every frame and execute compute pass
  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime
    // Update compute shader time uniform for wind field sampling
    computeMaterial.uniforms.uTime.value = state.clock.elapsedTime
    // Update LOD range
    uniforms.uLODRange.value.set(lodControls.lodStart, lodControls.lodEnd)
    compute() // Execute compute pass (single pass, multiple outputs)
    
    // Update light direction and color from scene
    const light = scene.children.find((child) => child.type === 'DirectionalLight') as THREE.DirectionalLight | undefined
    if (light) {
      // Get light direction: from light position to target position
      const lightPos = new THREE.Vector3()
      const targetPos = new THREE.Vector3()
      light.getWorldPosition(lightPos)
      light.target.getWorldPosition(targetPos)
      
      const lightDir = targetPos.sub(lightPos).normalize()
      uniforms.uLightDirection.value.copy(lightDir)
      
      // Get light color
      const lightColor = new THREE.Color(light.color)
      uniforms.uLightColor.value.set(lightColor.r, lightColor.g, lightColor.b)
    }
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
