import { AdaptiveDpr, CameraControls, Environment } from "@react-three/drei";
import { CanvasCapture } from "@packages/r3f-gist/components/utility";
import { LevaWrapper } from "@packages/r3f-gist/components";
import { Canvas } from "@react-three/fiber";
import Grass from "../components/Grass";
import { useState } from "react";
import Effects from "../components/Effects";
import { Terrain } from "../components/Terrain";
import { DirectionalLight } from "../components/DirectionalLight";
import { Sky } from "../components/Sky";
import * as THREE from 'three'

export default function App() {
    const [terrainParams, setTerrainParams] = useState<{ amplitude: number; frequency: number; seed: number; color: string } | undefined>(undefined)
    const [lightPosition, setLightPosition] = useState<THREE.Vector3 | undefined>(undefined)

    return <>
        <LevaWrapper />

        <Canvas
            shadows
            camera={{
                fov: 45,
                near: 0.1,
                far: 30,
                position: [0, 3, 10]
            }}
            gl={{ preserveDrawingBuffer: true }}
            dpr={[1, 2]}
            performance={{ min: 0.5, max: 1 }}
        >
            <color attach="background" args={['#000000']} />
            <AdaptiveDpr pixelated />

            <CameraControls makeDefault />
            <Environment preset="city" environmentIntensity={0.2} />
            <DirectionalLight onPositionChange={setLightPosition} />
            <Sky sunPosition={lightPosition} />
            <Terrain onParamsChange={setTerrainParams} />
            <Grass terrainParams={terrainParams} />
            <CanvasCapture />
            <Effects />
        </Canvas>
    </>
}
