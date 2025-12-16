import { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three'
import { useControls, folder } from 'leva'
import { useFrame } from '@react-three/fiber'
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

    const [computeParams] = useControls('Grass.Compute', () => ({
        Shape: folder({
            bladeHeightMin: { value: 0.4, min: 0.1, max: 2.0, step: 0.1 },
            bladeHeightMax: { value: 0.8, min: 0.1, max: 2.0, step: 0.1 },
            bladeWidthMin: { value: 0.01, min: 0.01, max: 0.1, step: 0.001 },
            bladeWidthMax: { value: 0.05, min: 0.01, max: 0.1, step: 0.001 },
            bendAmountMin: { value: 0.2, min: 0.0, max: 1.0, step: 0.1 },
            bendAmountMax: { value: 0.6, min: 0.0, max: 1.0, step: 0.1 },
            bladeRandomness: { value: { x: 0.3, y: 0.3, z: 0.2 }, step: 0.01, min: 0.0, max: 1.0 },
        }),
        Clump: folder({
            clumpSize: { value: 0.8, min: 0.1, max: 5.0, step: 0.1 },
            clumpRadius: { value: 1.5, min: 0.3, max: 2.0, step: 0.1 },
        }),
        Angle: folder({
            centerYaw: { value: 1.0, min: 0.0, max: 3.0, step: 0.1 },
            bladeYaw: { value: 1.2, min: 0.0, max: 3.0, step: 0.1 },
            clumpYaw: { value: 0.5, min: 0.0, max: 2.0, step: 0.1 },
        }),
    }))

    // Vertex/Fragment shader parameters
    const renderingParams = useControls('Grass.Rendering', {
        thicknessStrength: { value: 0.02, min: 0.0, max: 0.1, step: 0.001 },
        baseColor: { value: '#213110' },
        tipColor: { value: '#3e8d2f' },
    })

    const geometry = useMemo(() => createGrassGeometry(), [])

    const materialRef = useRef<any>(null)

    const materialControls = useControls('Grass.Material', {
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

    // Use grass compute hook for Multiple Render Targets (before uniforms definition)
    const windDirVec = useMemo(() => {
        const dir = new THREE.Vector2(wind.dirX, wind.dirZ).normalize()
        return dir
    }, [wind.dirX, wind.dirZ])
    
    const bladeRandomnessVec = useMemo(() => {
        const r = computeParams.bladeRandomness as any
        return new THREE.Vector3(r.x, r.y, r.z)
    }, [computeParams.bladeRandomness])

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
        uWindScale: wind.scale,
        uWindSpeed: wind.speed,
        uWindDir: windDirVec,
    }), [computeParams, bladeRandomnessVec, wind.scale, wind.speed, windDirVec])

    const { bladeParamsRT, clumpDataRT, additionalDataRT, computeMaterial, compute } = useGrassCompute(computeConfig)

    const uniforms = useRef({
        thicknessStrength: { value: 0.02 },
        baseColor: { value: new THREE.Vector3(0.18, 0.35, 0.12) },
        tipColor: { value: new THREE.Vector3(0.35, 0.65, 0.28) },
        // Multiple render target textures
        uBladeParamsTexture: { value: bladeParamsRT.texture },
        uClumpDataTexture: { value: clumpDataRT.texture },
        uMotionSeedsTexture: { value: additionalDataRT.texture },
        uGrassTextureSize: { value: new THREE.Vector2(GRID_SIZE, GRID_SIZE) },
        // Wind uniforms
        uTime: { value: 0 },
        uWindStrength: { value: 0.35 }, // Still needed for scaling wind effects in vertex shader
        uWindDir: { value: new THREE.Vector2(1, 0) }, // Wind direction for sway direction
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
        uniforms.thicknessStrength.value = renderingParams.thicknessStrength
        
        // Convert Leva color (string or object) to Vector3
        const baseColorVec = new THREE.Color(renderingParams.baseColor as any)
        uniforms.baseColor.value.set(baseColorVec.r, baseColorVec.g, baseColorVec.b)
        
        const tipColorVec = new THREE.Color(renderingParams.tipColor as any)
        uniforms.tipColor.value.set(tipColorVec.r, tipColorVec.g, tipColorVec.b)
        
        // Update wind uniforms
        const windDir = new THREE.Vector2(wind.dirX, wind.dirZ).normalize()
        uniforms.uWindStrength.value = wind.strength
        uniforms.uWindDir.value.set(windDir.x, windDir.y)
        // Note: uWindSpeed is only updated in compute shader
        
        // Trigger shadow material to recompile when uniforms change
        depthMat.needsUpdate = true
    }, [renderingParams, wind, depthMat])

    // Update time every frame and execute compute pass
    useFrame((state) => {
        uniforms.uTime.value = state.clock.elapsedTime
        // Update compute shader time uniform for wind field sampling
        computeMaterial.uniforms.uTime.value = state.clock.elapsedTime
        compute() // Execute compute pass (single pass, multiple outputs)
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
