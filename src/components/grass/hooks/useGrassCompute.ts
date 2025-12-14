// ============================================================================
// Hook for Grass Compute Pass (Multiple Render Targets)
// ============================================================================
import { useMemo, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { createPositionTexture } from '../utils'
import { GRID_SIZE } from '../constants'
import grassComputeShader from '../shaders/grassComputeShader.glsl?raw'

export function useGrassCompute(
    bladeHeight: number,
    bladeWidth: number,
    bendAmount: number,
    clumpSize: number,
    clumpRadius: number
) {
    const gl = useThree((state) => state.gl)
    
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

    // Create compute material for Multiple Render Targets
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

    // Initialize compute pass once
    useEffect(() => {
        const currentRenderTarget = gl.getRenderTarget()
        
        // Render to multiple render targets in single pass
        gl.setRenderTarget(mrt)
        gl.render(computeScene, computeCamera)
        
        // Restore render target
        gl.setRenderTarget(currentRenderTarget)
    }, [gl, mrt, computeScene, computeCamera, grassComputeMat])

    // Update compute material uniforms when params change
    useEffect(() => {
        grassComputeMat.uniforms.bladeHeight.value = bladeHeight
        grassComputeMat.uniforms.bladeWidth.value = bladeWidth
        grassComputeMat.uniforms.bendAmount.value = bendAmount
        grassComputeMat.uniforms.clumpSize.value = clumpSize
        grassComputeMat.uniforms.clumpRadius.value = clumpRadius
    }, [bladeHeight, bladeWidth, bendAmount, clumpSize, clumpRadius, grassComputeMat])

    return {
        bladeParamsRT,
        clumpDataRT,
        compute: () => {
            const currentRenderTarget = gl.getRenderTarget()
            gl.setRenderTarget(mrt)
            gl.render(computeScene, computeCamera)
            gl.setRenderTarget(currentRenderTarget)
        }
    }
}

