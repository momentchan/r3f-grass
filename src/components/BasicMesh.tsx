import { useRef } from 'react'
import { useControls } from 'leva'
import { CustomShaderMaterial } from "@packages/r3f-gist/shaders/materials"
import * as THREE from 'three'

const fragmentShader = /* glsl */ `
    varying vec2 vUv;
    uniform float uAlpha;

    void main() {
        vec3 color = vec3(vUv, 0.0);
        gl_FragColor = vec4(color, uAlpha);
    }
`

export default function BasicMesh() {
    const materialRef = useRef<THREE.ShaderMaterial>(null)

    const { alpha } = useControls('Material', {
        alpha: {
            value: 1,
            min: 0,
            max: 1,
            step: 0.01
        }
    })

    return (
        <mesh>
            <planeGeometry args={[2, 2]} />
            <CustomShaderMaterial
                ref={materialRef}
                fragmentShader={fragmentShader}
                uniforms={{ uAlpha: alpha }}
                transparent={true}
                side={2}
            />
        </mesh>
    )
}
