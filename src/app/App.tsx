import { AdaptiveDpr, CameraControls, Environment } from "@react-three/drei";
import { CanvasCapture } from "@packages/r3f-gist/components/utility";
import { LevaWrapper } from "@packages/r3f-gist/components";
import { Canvas } from "@react-three/fiber";
import Grass from "../components/Grass";
import { useState } from "react";
import Effects from "../components/Effects";
import { Terrain } from "../components/Terrain";
import { DirectionalLight } from "../components/DirectionalLight";
import { Background } from "../components/background/Background";
import * as THREE from 'three'

export default function App() {
    const [terrainParams, setTerrainParams] = useState<{ amplitude: number; frequency: number; seed: number; color: string } | undefined>(undefined)
    const [lightPosition, setLightPosition] = useState<THREE.Vector3 | undefined>(undefined)

    return <>
        <LevaWrapper collapsed={true} />

        <Canvas
            shadows
            camera={{
                fov: 45,
                near: 0.1,
                far: 50,
                position: [0, 3, 10]
            }}
            gl={{ preserveDrawingBuffer: true }}
            dpr={[1, 2]}
            performance={{ min: 0.5, max: 1 }}
        >
            <color attach="background" args={['#000000']} />
            <AdaptiveDpr pixelated />

            <CameraControls makeDefault maxDistance={20} minDistance={5} maxPolarAngle={Math.PI / 2.2} minPolarAngle={Math.PI / 4} dollySpeed={0.5} />
            <Environment preset="city" environmentIntensity={0.2} />
            <DirectionalLight onPositionChange={setLightPosition} />
            <Background sunPosition={lightPosition} />
            <Terrain onParamsChange={setTerrainParams} />
            <Grass terrainParams={terrainParams} />
            <CanvasCapture />
            <Effects />
        </Canvas>
    </>
}
