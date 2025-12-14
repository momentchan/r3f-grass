import { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three'
import { useControls } from 'leva'
import { useFrame } from '@react-three/fiber'
import CustomShaderMaterial from 'three-custom-shader-material'
import CustomShaderMaterialVanilla from 'three-custom-shader-material/vanilla'
import utility from '@packages/r3f-gist/shaders/cginc/math/utility.glsl'
import fractal from '@packages/r3f-gist/shaders/cginc/noise/fractal.glsl'
import { GRID_SIZE, GRASS_BLADES, BLADE_HEIGHT, BLADE_WIDTH } from './grass/constants'
import { createGrassGeometry } from './grass/utils'
import { useGrassCompute } from './grass/hooks/useGrassCompute'
import grassVertexShader from './grass/shaders/grassVertex.glsl?raw'
import grassFragmentShader from './grass/shaders/grassFragment.glsl?raw'

// ============================================================================
// Vertex Shader (with includes)
// ============================================================================
const grassVertex = /* glsl */ `
  ${utility}
  ${fractal}
  ${grassVertexShader}
`

// ============================================================================
// Fragment Shader
// ============================================================================
const grassFragment = grassFragmentShader

// ============================================================================
// Component
// ============================================================================
export default function Grass() {
    const { bladeHeight, bladeWidth, bendAmount, clumpSize, clumpRadius, thicknessStrength, baseColor, tipColor } = useControls('Grass', {
        bladeHeight: { value: BLADE_HEIGHT, min: 0.1, max: 2.0, step: 0.1 },
        bladeWidth: { value: BLADE_WIDTH, min: 0.01, max: 0.1, step: 0.01 },
        bendAmount: { value: 0.4, min: 0.0, max: 1.0, step: 0.1 },
        clumpSize: { value: 0.8, min: 0.1, max: 5.0, step: 0.1 },
        clumpRadius: { value: 1.5, min: 0.3, max: 2.0, step: 0.1 },
        thicknessStrength: { value: 0.02, min: 0.0, max: 0.1, step: 0.001 },
        tipColor: { value: '#3e8d2f', label: 'Tip Color' },
        baseColor: { value: '#213110', label: 'Base Color' },
    })

    const geometry = useMemo(() => createGrassGeometry(), [])

    // Use grass compute hook for Multiple Render Targets
    const { bladeParamsRT, clumpDataRT, compute } = useGrassCompute(
        bladeHeight,
        bladeWidth,
        bendAmount,
        clumpSize,
        clumpRadius
    )

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

    // Update time every frame and execute compute pass
    useFrame((state) => {
        uniforms.uTime.value = state.clock.elapsedTime
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
