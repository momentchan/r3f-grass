import { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three'
import { useControls, folder } from 'leva'
import { useFrame, useThree } from '@react-three/fiber'
import CustomShaderMaterial from 'three-custom-shader-material'
import CustomShaderMaterialVanilla from 'three-custom-shader-material/vanilla'
import utility from '@packages/r3f-gist/shaders/cginc/math/utility.glsl'
import simplexNoise from '@packages/r3f-gist/shaders/cginc/noise/simplexNoise.glsl'
import { GRID_SIZE, GRASS_BLADES } from './grass/constants'
import { createGrassGeometry } from './grass/utils'
import { useGrassCompute } from './grass/hooks/useGrassCompute'
import grassVertexShader from './grass/shaders/grassVertex.glsl?raw'
import grassFragmentShader from './grass/shaders/grassFragment.glsl?raw'
import { terrainMath } from './terrain/TerrainMath'

const grassVertex = /* glsl */ `
  ${utility}
  ${terrainMath}
  ${grassVertexShader}
`
const grassFragment = /* glsl */ `
  ${utility}
  ${simplexNoise}
  ${grassFragmentShader}
`

interface GrassProps {
  terrainParams?: {
    amplitude: number
    frequency: number
    seed: number
    color: string
  }
}

export default function Grass({ terrainParams }: GrassProps = {} as GrassProps) {
  const { scene } = useThree()

  const [grassParams] = useControls('Grass', () => ({
    Geometry: folder({
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
        thicknessStrength: { value: 0.02, min: 0.0, max: 0.1, step: 0.001 },
      }, { collapsed: true }),
      Clump: folder({
        clumpSize: { value: 0.8, min: 0.1, max: 5.0, step: 0.1 },
        clumpRadius: { value: 1.5, min: 0.3, max: 2.0, step: 0.1 },
        typeTrendScale: { value: 0.1, min: 0.01, max: 1.0, step: 0.01 },
      }, { collapsed: true }),
      Angle: folder({
        centerYaw: { value: 1.0, min: 0.0, max: 3.0, step: 0.1 },
        bladeYaw: { value: 1.2, min: 0.0, max: 3.0, step: 0.1 },
        clumpYaw: { value: 0.5, min: 0.0, max: 2.0, step: 0.1 },
      }, { collapsed: true }),
    }, { collapsed: true }),
    Appearance: folder({
      Color: folder({
        tipColor: { value: '#3e8d2f' },
        baseColor: { value: '#213110' },
        bladeSeedRange: { value: { x: 0.95, y: 1.03 }, step: 0.01, min: 0.5, max: 1.5 },
        clumpInternalRange: { value: { x: 0.95, y: 1.05 }, step: 0.01, min: 0.5, max: 1.5 },
        clumpSeedRange: { value: { x: 0.9, y: 1.1 }, step: 0.01, min: 0.5, max: 1.5 },
        aoPower: { value: 5, min: 0.1, max: 20.0, step: 0.1 },
      }, { collapsed: true }),
      Normal: folder({
        midSoft: { value: 0.25, min: 0.0, max: 1.0, step: 0.01 },
        rimPos: { value: 0.42, min: 0.0, max: 1.0, step: 0.01 },
        rimSoft: { value: 0.03, min: 0.0, max: 0.1, step: 0.001 },
      }, { collapsed: true }),
      Lighting: folder({
        backLightStrength: { value: 0.2, min: 0.0, max: 2.0, step: 0.1 },
      }, { collapsed: true }),
      Noise: folder({
        noiseFreqX: { value: 5, min: 0.1, max: 10.0, step: 0.1 },
        noiseFreqY: { value: 10, min: 0.1, max: 10.0, step: 0.1 },
        noiseRemapMin: { value: 0.7, min: 0.0, max: 1.0, step: 0.01 },
        noiseRemapMax: { value: 1.0, min: 0.0, max: 1.0, step: 0.01 },
      }, { collapsed: true }),
    }, { collapsed: true }),
    Animation: folder({
      Wind: folder({
        windDirX: { value: 1, min: -1, max: 1, step: 0.01 },
        windDirZ: { value: 0, min: -1, max: 1, step: 0.01 },
        windSpeed: { value: 0.6, min: 0, max: 3, step: 0.01 },
        windStrength: { value: 0.35, min: 0, max: 2, step: 0.01 },
        windScale: { value: 0.25, min: 0.01, max: 2, step: 0.01 },
        windFacing: { value: 0.6, min: 0.0, max: 1.0, step: 0.01 },
        swayFreqMin: { value: 0.4, min: 0.1, max: 10.0, step: 0.1 },
        swayFreqMax: { value: 1.5, min: 0.1, max: 10.0, step: 0.1 },
        swayStrength: { value: 0.1, min: 0.0, max: 0.5, step: 0.001 },
        windDistanceStart: { value: 10, min: 0, max: 100, step: 1 },
        windDistanceEnd: { value: 30, min: 0, max: 200, step: 1 },
      }, { collapsed: true }),
    }, { collapsed: true }),
    Performance: folder({
      LOD: folder({
        lodStart: { value: 5, min: 0, max: 50, step: 1 },
        lodEnd: { value: 15, min: 0, max: 50, step: 1 },
      }, { collapsed: true }),
      Culling: folder({
        cullStart: { value: 15, min: 0, max: 200, step: 1 },
        cullEnd: { value: 30, min: 0, max: 300, step: 1 },
        compensation: { value: 1.5, min: 1.0, max: 3.0, step: 0.1 },
      }, { collapsed: true }),
    }, { collapsed: true }),
  }), { collapsed: true })

  const geometry = useMemo(() => createGrassGeometry(), [])

  const materialRef = useRef<any>(null)

  const materialControls = useControls('Grass.Material', {
    roughness: { value: 0.3, min: 0.0, max: 1.0, step: 0.01 },
    metalness: { value: 0.5, min: 0.0, max: 1.0, step: 0.01 },
    emissive: { value: '#000000' },
    envMapIntensity: { value: 0.5, min: 0.0, max: 3.0, step: 0.1 },
  }, { collapsed: true })

  const emissiveColor = useMemo(() => new THREE.Color(materialControls.emissive as any), [materialControls.emissive])

  // Use grass compute hook for Multiple Render Targets (before uniforms definition)
  const params = grassParams as any
  const bladeRandomnessVec = useMemo(() => {
    const r = params.bladeRandomness
    return new THREE.Vector3(r.x, r.y, r.z)
  }, [params.bladeRandomness])

  const windDirVec = useMemo(() => {
    const dir = new THREE.Vector2(params.windDirX, params.windDirZ).normalize()
    return dir
  }, [params.windDirX, params.windDirZ])

  const computeConfig = useMemo(() => ({
    bladeHeightMin: params.bladeHeightMin,
    bladeHeightMax: params.bladeHeightMax,
    bladeWidthMin: params.bladeWidthMin,
    bladeWidthMax: params.bladeWidthMax,
    bendAmountMin: params.bendAmountMin,
    bendAmountMax: params.bendAmountMax,
    clumpSize: params.clumpSize,
    clumpRadius: params.clumpRadius,
    uCenterYaw: params.centerYaw,
    uBladeYaw: params.bladeYaw,
    uClumpYaw: params.clumpYaw,
    uBladeRandomness: bladeRandomnessVec,
    uTypeTrendScale: params.typeTrendScale,
    uTime: 0.0, // Initial value, updated in useFrame
    uWindScale: params.windScale,
    uWindSpeed: params.windSpeed,
    uWindDir: windDirVec,
    uWindFacing: params.windFacing,
    uWindStrength: params.windStrength,
  }), [params, bladeRandomnessVec, windDirVec])

  const { bladeParamsRT, clumpDataRT, additionalDataRT, computeMaterial, compute } = useGrassCompute(computeConfig)

  const uniforms = useRef({
    // Texture Uniforms
    uTextureBladeParams: { value: bladeParamsRT.texture },
    uTextureClumpData: { value: clumpDataRT.texture },
    uTextureMotionSeeds: { value: additionalDataRT.texture },
    uTextureGrassSize: { value: new THREE.Vector2(GRID_SIZE, GRID_SIZE) },
    // Geometry Uniforms
    uGeometryThicknessStrength: { value: 0.02 },
    uGeometryBaseWidth: { value: 0.35 },
    uGeometryTipThin: { value: 0.9 },
    // Wind Uniforms
    uWindTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindSwayFreqMin: { value: 1.0 },
    uWindSwayFreqMax: { value: 2.2 },
    uWindSwayStrength: { value: 1.0 },
    uWindDistanceRange: { value: new THREE.Vector2(10, 30) },
    // Color Uniforms
    uBaseColor: { value: new THREE.Vector3(0.18, 0.35, 0.12) },
    uTipColor: { value: new THREE.Vector3(0.35, 0.65, 0.28) },
    uBladeSeedRange: { value: new THREE.Vector2(0.95, 1.03) },
    uClumpInternalRange: { value: new THREE.Vector2(0.95, 1.05) },
    uClumpSeedRange: { value: new THREE.Vector2(0.9, 1.1) },
    uAOPower: { value: 0.6 },
    uGroundColor: { value: new THREE.Vector3(0.1, 0.2, 0.05) },
    uNoiseParams: { value: new THREE.Vector4(1.0, 3.0, 0.7, 1.0) },
    // Normal Uniforms
    uMidSoft: { value: 0.2 },
    uRimPos: { value: 0.42 },
    uRimSoft: { value: 0.2 },
    // Lighting Uniforms
    uLightDirection: { value: new THREE.Vector3(0, 0, -1) },
    uLightColor: { value: new THREE.Vector3(1, 1, 1) },
    uLightBackStrength: { value: 0.6 },
    // LOD Uniforms
    uLODRange: { value: new THREE.Vector2(15, 40) },
    // Cull Uniforms
    uCullParams: { value: new THREE.Vector3(40, 80, 1.5) },
    // Terrain Uniforms
    uTerrainAmp: { value: 0.3 },
    uTerrainFreq: { value: 0.4 },
    uTerrainSeed: { value: 0.0 },
  }).current

  // Update texture uniforms when render targets change
  useEffect(() => {
    uniforms.uTextureBladeParams.value = bladeParamsRT.texture
    uniforms.uTextureClumpData.value = clumpDataRT.texture
    uniforms.uTextureMotionSeeds.value = additionalDataRT.texture
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

    return m
  }, [uniforms])

  useEffect(() => {
    const p = grassParams as any

    // Update geometry uniforms
    uniforms.uGeometryThicknessStrength.value = p.thicknessStrength
    uniforms.uGeometryBaseWidth.value = p.baseWidth
    uniforms.uGeometryTipThin.value = p.tipThin

    // Update color uniforms
    const baseColorVec = new THREE.Color(p.baseColor)
    uniforms.uBaseColor.value.set(baseColorVec.r, baseColorVec.g, baseColorVec.b)

    const tipColorVec = new THREE.Color(p.tipColor)
    uniforms.uTipColor.value.set(tipColorVec.r, tipColorVec.g, tipColorVec.b)

    uniforms.uBladeSeedRange.value.set(p.bladeSeedRange.x, p.bladeSeedRange.y)
    uniforms.uClumpInternalRange.value.set(p.clumpInternalRange.x, p.clumpInternalRange.y)
    uniforms.uClumpSeedRange.value.set(p.clumpSeedRange.x, p.clumpSeedRange.y)
    uniforms.uAOPower.value = p.aoPower

    // Use terrain color if available, otherwise use default
    const groundColor = terrainParams?.color || '#1a3310'
    const groundColorVec = new THREE.Color(groundColor)
    uniforms.uGroundColor.value.set(groundColorVec.r, groundColorVec.g, groundColorVec.b)

    uniforms.uNoiseParams.value.set(
      p.noiseFreqX,
      p.noiseFreqY,
      p.noiseRemapMin,
      p.noiseRemapMax
    )

    // Update normal uniforms
    uniforms.uMidSoft.value = p.midSoft
    uniforms.uRimPos.value = p.rimPos
    uniforms.uRimSoft.value = p.rimSoft

    // Update lighting uniforms
    uniforms.uLightBackStrength.value = p.backLightStrength

    // Update wind uniforms
    uniforms.uWindDir.value.set(windDirVec.x, windDirVec.y)
    uniforms.uWindSwayFreqMin.value = p.swayFreqMin
    uniforms.uWindSwayFreqMax.value = p.swayFreqMax
    uniforms.uWindSwayStrength.value = p.swayStrength
    uniforms.uWindDistanceRange.value.set(p.windDistanceStart, p.windDistanceEnd)

    // Update culling uniforms
    uniforms.uCullParams.value.set(p.cullStart, p.cullEnd, p.compensation)

    // Sync Terrain Params
    if (terrainParams) {
      uniforms.uTerrainAmp.value = terrainParams.amplitude
      uniforms.uTerrainFreq.value = terrainParams.frequency
      uniforms.uTerrainSeed.value = terrainParams.seed
    }

    // Trigger shadow material to recompile when uniforms change
    depthMat.needsUpdate = true
  }, [grassParams, windDirVec, depthMat, terrainParams])

  // Set envMap from scene
  useEffect(() => {
    if (materialRef.current && scene.environment) {
      materialRef.current.envMap = scene.environment
      materialRef.current.needsUpdate = true
    }
  }, [scene.environment])

  // Update time every frame and execute compute pass
  useFrame((state) => {
    uniforms.uWindTime.value = state.clock.elapsedTime
    // Update compute shader time uniform for wind field sampling
    computeMaterial.uniforms.uWindTime.value = state.clock.elapsedTime
    // Update LOD range
    const p = grassParams as any
    uniforms.uLODRange.value.set(p.lodStart, p.lodEnd)
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
        envMapIntensity={materialControls.envMapIntensity}
      />
    </instancedMesh>
  )
}
