import { AdaptiveDpr, CameraControls, useHelper } from "@react-three/drei";
import { CanvasCapture } from "@packages/r3f-gist/components/utility";
import BasicMesh from '../components/BasicMesh'
import { LevaWrapper } from "@packages/r3f-gist/components";
import { Canvas, useFrame } from "@react-three/fiber";
import Grass from "../components/Grass";
import { useRef, useMemo } from "react";
import { useControls } from "leva";
import * as THREE from 'three'
import { CustomShaderMaterial } from "@packages/r3f-gist/shaders/materials/CustomShaderMaterial";

function DirectionalLightHelper() {
    const directionalLightRef = useRef<THREE.DirectionalLight>(null)
    useHelper(directionalLightRef as React.MutableRefObject<THREE.Object3D>, THREE.DirectionalLightHelper, 1, 'red')
    
    const { rotationSpeed } = useControls('Directional Light', {
        rotationSpeed: { value: 0., min: 0, max: 2, step: 0.1 }
    })
    
    const basePosition = useMemo(() => new THREE.Vector3(0, 2, 5), [])
    const position = useMemo(() => new THREE.Vector3(), [])
    
    useFrame((state) => {
        if (!directionalLightRef.current) return
        
        const rotationY = state.clock.elapsedTime * rotationSpeed
        position.copy(basePosition)
        const rotationMatrix = new THREE.Matrix4().makeRotationY(rotationY)
        position.applyMatrix4(rotationMatrix)
        directionalLightRef.current.position.copy(position)
    })
    
    return (
        <directionalLight ref={directionalLightRef} castShadow position={basePosition.toArray()} intensity={1} />
    )
}

function NormalSphere() {
    const normalVertexShader = /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        
        void main() {
            vNormal = normal;
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;
    
    const normalFragmentShader = /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        
        void main() {
            // Map normal from [-1, 1] to [0, 1] for color display
            vec3 color = vWorldNormal * 0.5 + 0.5;
            gl_FragColor = vec4(color, 1.0);
        }
    `;
    
    return (
        <mesh position={[2, 0, 0]}>
            <sphereGeometry args={[1, 32, 32]} />
            <CustomShaderMaterial
                vertexShader={normalVertexShader}
                fragmentShader={normalFragmentShader}
            />
        </mesh>
    );
}

export default function App() {
    return <>
        <LevaWrapper />

        <Canvas
            shadows
            camera={{
                fov: 45,
                near: 0.1,
                far: 200,
                position: [0, 0, 5]
            }}
            gl={{ preserveDrawingBuffer: true, toneMapping: THREE.NoToneMapping  }}
            dpr={[1, 2]}
            performance={{ min: 0.5, max: 1 }}
        >
            <color attach="background" args={['#ffffff']} />
            <AdaptiveDpr pixelated />

            <CameraControls makeDefault />
            <DirectionalLightHelper />
            {/* <BasicMesh /> */}
            <Grass />
            {/* <NormalSphere /> */}
            <CanvasCapture />
        </Canvas>
    </>
}
