import { AdaptiveDpr, CameraControls, Environment, useHelper } from "@react-three/drei";
import { CanvasCapture } from "@packages/r3f-gist/components/utility";
import { LevaWrapper } from "@packages/r3f-gist/components";
import { Canvas, useFrame } from "@react-three/fiber";
import Grass from "../components/Grass";
import { useRef, useMemo, useEffect } from "react";
import { useControls } from "leva";
import * as THREE from 'three'
import { CustomShaderMaterial } from "@packages/r3f-gist/shaders/materials/CustomShaderMaterial";
import Effects from "../components/Effects";

function DirectionalLightHelper() {
    const directionalLightRef = useRef<THREE.DirectionalLight>(null)
    useHelper(directionalLightRef as React.MutableRefObject<THREE.Object3D>, THREE.DirectionalLightHelper, 1, 'red')
    
    const { rotationSpeed, color, intensity } = useControls('Directional Light', {
        rotationSpeed: { value: 0.5, min: 0, max: 2, step: 0.1 },
        color: { value: '#ffffff' },
        intensity: { value: 1.0, min: 0, max: 3, step: 0.1 },
    })
    
    const basePosition = useMemo(() => new THREE.Vector3(0, 2, 5), [])
    const position = useMemo(() => new THREE.Vector3(), [])
    
    // Update light properties
    useEffect(() => {
        if (!directionalLightRef.current) return
        
        const light = directionalLightRef.current
        
        // Update light color and intensity
        light.color.set(color)
        light.intensity = intensity
    }, [color, intensity])
    
    useFrame((state) => {
        if (!directionalLightRef.current) return
        
        const rotationY = state.clock.elapsedTime * rotationSpeed
        position.copy(basePosition)
        const rotationMatrix = new THREE.Matrix4().makeRotationY(rotationY)
        position.applyMatrix4(rotationMatrix)
        directionalLightRef.current.position.copy(position)
    })
    
    return (
        <directionalLight ref={directionalLightRef} castShadow position={basePosition.toArray()} intensity={1.0} />
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
                far: 20,
                position: [0, 0, 5]
            }}
            gl={{ preserveDrawingBuffer: true }}
            dpr={[1, 2]}
            performance={{ min: 0.5, max: 1 }}
        >
            <color attach="background" args={['#000000']} />
            <AdaptiveDpr pixelated />

            <CameraControls makeDefault />
            <Environment preset="city" environmentIntensity={0.2} />
            <DirectionalLightHelper />
            {/* <BasicMesh /> */}
            <Grass />
            {/* <NormalSphere /> */}
            <CanvasCapture />
            <Effects />
            <mesh receiveShadow rotation-x={-Math.PI / 2}>
                <planeGeometry args={[10, 10]}  />
                <meshStandardMaterial color="white"/>
            </mesh>

        </Canvas>
    </>
}
