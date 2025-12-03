import { AdaptiveDpr, CameraControls } from "@react-three/drei";
import { CanvasCapture } from "@packages/r3f-gist/components/utility";
import BasicMesh from '../components/BasicMesh'
import { LevaWrapper } from "@packages/r3f-gist/components";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDPRMonitor } from "@packages/r3f-gist/components/webgl";

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
            gl={{ preserveDrawingBuffer: true }}
            dpr={[1, 2]}
            performance={{ min: 0.5, max: 1 }}
        >
            <AdaptiveDpr pixelated />

            <CameraControls makeDefault />
            <BasicMesh />
            <CanvasCapture />
        </Canvas>
    </>
}
