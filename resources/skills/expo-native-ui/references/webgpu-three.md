# WebGPU & Three.js for Expo

**Use this skill for ANY 3D graphics, games, GPU compute, or Three.js features in React Native.**

## Locked Versions (Tested & Working)

```json
{
  "react-native-wgpu": "^0.4.1",
  "three": "0.172.0",
  "@react-three/fiber": "^9.4.0",
  "wgpu-matrix": "^3.0.2",
  "@types/three": "0.172.0"
}
```

**Critical:** These versions are tested together. Mismatched versions cause type errors and runtime issues.

## Installation

```bash
npm install react-native-wgpu@^0.4.1 three@0.172.0 @react-three/fiber@^9.4.0 wgpu-matrix@^3.0.2 @types/three@0.172.0 --legacy-peer-deps
```

**Note:** `--legacy-peer-deps` may be required due to peer dependency conflicts with canary Expo versions.

## Metro Configuration

Create `metro.config.js` in project root:

```js
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Force 'three' to webgpu build
  if (moduleName.startsWith("three")) {
    moduleName = "three/webgpu";
  }

  // Use standard react-three/fiber instead of React Native version
  if (platform !== "web" && moduleName.startsWith("@react-three/fiber")) {
    return context.resolveRequest(
      {
        ...context,
        unstable_conditionNames: ["module"],
        mainFields: ["module"],
      },
      moduleName,
      platform
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
```

## Required Lib Files

Create these files in `src/lib/`:

### 1. make-webgpu-renderer.ts

```ts
import type { NativeCanvas } from "react-native-wgpu";
import * as THREE from "three/webgpu";

export class ReactNativeCanvas {
  constructor(private canvas: NativeCanvas) {}

  get width() {
    return this.canvas.width;
  }
  get height() {
    return this.canvas.height;
  }
  set width(width: number) {
    this.canvas.width = width;
  }
  set height(height: number) {
    this.canvas.height = height;
  }
  get clientWidth() {
    return this.canvas.width;
  }
  get clientHeight() {
    return this.canvas.height;
  }
  set clientWidth(width: number) {
    this.canvas.width = width;
  }
  set clientHeight(height: number) {
    this.canvas.height = height;
  }

  addEventListener(_type: string, _listener: EventListener) {}
  removeEventListener(_type: string, _listener: EventListener) {}
  dispatchEvent(_event: Event) {}
  setPointerCapture() {}
  releasePointerCapture() {}
}

export const makeWebGPURenderer = (
  context: GPUCanvasContext,
  { antialias = true }: { antialias?: boolean } = {}
) =>
  new THREE.WebGPURenderer({
    antialias,
    // @ts-expect-error
    canvas: new ReactNativeCanvas(context.canvas),
    context,
  });
```

### 2. fiber-canvas.tsx

```tsx
import * as THREE from "three/webgpu";
import React, { useEffect, useRef } from "react";
import type { ReconcilerRoot, RootState } from "@react-three/fiber";
import {
  extend,
  createRoot,
  unmountComponentAtNode,
  events,
} from "@react-three/fiber";
import type { ViewProps } from "react-native";
import { PixelRatio } from "react-native";
import { Canvas, type CanvasRef } from "react-native-wgpu";

import {
  makeWebGPURenderer,
  ReactNativeCanvas,
} from "@/lib/make-webgpu-renderer";

// Extend THREE namespace for R3F - add all components you use
extend({
  AmbientLight: THREE.AmbientLight,
  DirectionalLight: THREE.DirectionalLight,
  PointLight: THREE.PointLight,
  SpotLight: THREE.SpotLight,
  Mesh: THREE.Mesh,
  Group: THREE.Group,
  Points: THREE.Points,
  BoxGeometry: THREE.BoxGeometry,
  SphereGeometry: THREE.SphereGeometry,
  CylinderGeometry: THREE.CylinderGeometry,
  ConeGeometry: THREE.ConeGeometry,
  DodecahedronGeometry: THREE.DodecahedronGeometry,
  BufferGeometry: THREE.BufferGeometry,
  BufferAttribute: THREE.BufferAttribute,
  MeshStandardMaterial: THREE.MeshStandardMaterial,
  MeshBasicMaterial: THREE.MeshBasicMaterial,
  PointsMaterial: THREE.PointsMaterial,
  PerspectiveCamera: THREE.PerspectiveCamera,
  Scene: THREE.Scene,
});

interface FiberCanvasProps {
  children: React.ReactNode;
  style?: ViewProps["style"];
  camera?: THREE.PerspectiveCamera;
  scene?: THREE.Scene;
}

export const FiberCanvas = ({
  children,
  style,
  scene,
  camera,
}: FiberCanvasProps) => {
  const root = useRef<ReconcilerRoot<OffscreenCanvas>>(null!);
  const canvasRef = useRef<CanvasRef>(null);

  useEffect(() => {
    const context = canvasRef.current!.getContext("webgpu")!;
    const renderer = makeWebGPURenderer(context);

    // @ts-expect-error - ReactNativeCanvas wraps native canvas
    const canvas = new ReactNativeCanvas(context.canvas) as HTMLCanvasElement;
    canvas.width = canvas.clientWidth * PixelRatio.get();
    canvas.height = canvas.clientHeight * PixelRatio.get();
    const size = {
      top: 0,
      left: 0,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    };

    if (!root.current) {
      root.current = createRoot(canvas);
    }
    root.current.configure({
      size,
      events,
      scene,
      camera,
      gl: renderer,
      frameloop: "always",
      dpr: 1,
      onCreated: async (state: RootState) => {
        // @ts-expect-error - WebGPU renderer has init method
        await state.gl.init();
        const renderFrame = state.gl.render.bind(state.gl);
        state.gl.render = (s: THREE.Scene, c: THREE.Camera) => {
          renderFrame(s, c);
          context?.present();
        };
      },
    });
    root.current.render(children);
    return () => {
      if (canvas != null) {
        unmountComponentAtNode(canvas!);
      }
    };
  });

  return <Canvas ref={canvasRef} style={style} />;
};
```

## Basic 3D Scene

```tsx
import * as THREE from "three/webgpu";
import { View } from "react-native";
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { FiberCanvas } from "@/lib/fiber-canvas";

function RotatingBox() {
  const ref = useRef<THREE.Mesh>(null!);

  useFrame((_, delta) => {
    ref.current.rotation.x += delta;
    ref.current.rotation.y += delta * 0.5;
  });

  return (
    <mesh ref={ref}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="hotpink" />
    </mesh>
  );
}

function Scene() {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(0, 2, 5);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <RotatingBox />
    </>
  );
}

export default function App() {
  return (
    <View style={{ flex: 1 }}>
      <FiberCanvas style={{ flex: 1 }}>
        <Scene />
      </FiberCanvas>
    </View>
  );
}
```

## Lazy Loading (Recommended)

Use React.lazy to code-split Three.js for better loading:

```tsx
import React, { Suspense } from "react";
import { ActivityIndicator, View } from "react-native";

const Scene = React.lazy(() => import("@/components/scene"));

export default function Page() {
  return (
    <View style={{ flex: 1 }}>
      <Suspense fallback={<ActivityIndicator size="large" />}>
        <Scene />
      </Suspense>
    </View>
  );
}
```

## Common Geometries

```tsx
// Box
<mesh>
  <boxGeometry args={[width, height, depth]} />
  <meshStandardMaterial color="red" />
</mesh>

// Sphere
<mesh>
  <sphereGeometry args={[radius, widthSegments, heightSegments]} />
  <meshStandardMaterial color="blue" />
</mesh>

// Cylinder
<mesh>
  <cylinderGeometry args={[radiusTop, radiusBottom, height, segments]} />
  <meshStandardMaterial color="green" />
</mesh>

// Cone
<mesh>
  <coneGeometry args={[radius, height, segments]} />
  <meshStandardMaterial color="yellow" />
</mesh>
```

## Lighting

```tsx
// Ambient (uniform light everywhere)
<ambientLight intensity={0.5} />

// Directional (sun-like)
<directionalLight position={[10, 10, 5]} intensity={1} />

// Point (light bulb)
<pointLight position={[0, 5, 0]} intensity={2} distance={10} />

// Spot (flashlight)
<spotLight position={[0, 10, 0]} angle={0.3} penumbra={1} intensity={2} />
```

## Animation with useFrame

```tsx
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three/webgpu";

function AnimatedMesh() {
  const ref = useRef<THREE.Mesh>(null!);

  // Runs every frame - delta is time since last frame
  useFrame((state, delta) => {
    // Rotate
    ref.current.rotation.y += delta;

    // Oscillate position
    ref.current.position.y = Math.sin(state.clock.elapsedTime) * 2;
  });

  return (
    <mesh ref={ref}>
      <boxGeometry />
      <meshStandardMaterial color="orange" />
    </mesh>
  );
}
```

## Particle Systems

```tsx
import * as THREE from "three/webgpu";
import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";

function Particles({ count = 500 }) {
  const ref = useRef<THREE.Points>(null!);
  const positions = useRef<Float32Array>(new Float32Array(count * 3));

  useEffect(() => {
    for (let i = 0; i < count; i++) {
      positions.current[i * 3] = (Math.random() - 0.5) * 50;
      positions.current[i * 3 + 1] = (Math.random() - 0.5) * 50;
      positions.current[i * 3 + 2] = (Math.random() - 0.5) * 50;
    }
  }, [count]);

  useFrame((_, delta) => {
    // Animate particles
    for (let i = 0; i < count; i++) {
      positions.current[i * 3 + 1] -= delta * 2;
      if (positions.current[i * 3 + 1] < -25) {
        positions.current[i * 3 + 1] = 25;
      }
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions.current, 3]}
        />
      </bufferGeometry>
      <pointsMaterial color="#ffffff" size={0.2} sizeAttenuation />
    </points>
  );
}
```

## Touch Controls (Orbit)

See the full `orbit-controls.tsx` implementation in the lib files. Usage:

```tsx
import { View } from "react-native";
import { FiberCanvas } from "@/lib/fiber-canvas";
import useControls from "@/lib/orbit-controls";

function Scene() {
  const [OrbitControls, events] = useControls();

  return (
    <View style={{ flex: 1 }} {...events}>
      <FiberCanvas style={{ flex: 1 }}>
        <OrbitControls />
        {/* Your 3D content */}
      </FiberCanvas>
    </View>
  );
}
```

## Common Issues & Solutions

### 1. "X is not part of the THREE namespace"

**Problem:** Error like `AmbientLight is not part of the THREE namespace`

**Solution:** Add the missing component to the `extend()` call in fiber-canvas.tsx:

```tsx
extend({
  AmbientLight: THREE.AmbientLight,
  // Add other missing components...
});
```

### 2. TypeScript Errors with Three.js

**Problem:** Type mismatches between three.js and R3F

**Solution:** Use `@ts-expect-error` comments where needed:

```tsx
// @ts-expect-error - WebGPU renderer types don't match
await state.gl.init();
```

### 3. Blank Screen

**Problem:** Canvas renders but nothing visible

**Solution:**

1. Ensure camera is positioned correctly and looking at scene
2. Add lighting (objects are black without light)
3. Check that `extend()` includes all components used

### 4. Performance Issues

**Problem:** Low frame rate or stuttering

**Solution:**

- Reduce polygon count in geometries
- Use `useMemo` for static data
- Limit particle count
- Use `instancedMesh` for many identical objects

### 5. Peer Dependency Errors

**Problem:** npm install fails with ERESOLVE

**Solution:** Use `--legacy-peer-deps`:

```bash
npm install <packages> --legacy-peer-deps
```

## Building

WebGPU requires a custom build:

```bash
npx expo prebuild
npx expo run:ios
```

**Note:** WebGPU does NOT work in Expo Go.

## File Structure

```
src/
├── app/
│   └── index.tsx           # Entry point with lazy loading
├── components/
│   ├── scene.tsx           # Main 3D scene
│   └── game.tsx            # Game logic
└── lib/
    ├── fiber-canvas.tsx    # R3F canvas wrapper
    ├── make-webgpu-renderer.ts  # WebGPU renderer
    └── orbit-controls.tsx  # Touch controls
```

## Decision Tree

```
Need 3D graphics?
├── Simple shapes → mesh + geometry + material
├── Animated objects → useFrame + refs
├── Many objects → instancedMesh
├── Particles → Points + BufferGeometry
│
Need interaction?
├── Orbit camera → useControls hook
├── Touch objects → onClick on mesh
├── Gestures → react-native-gesture-handler
│
Performance critical?
├── Static geometry → useMemo
├── Many instances → InstancedMesh
└── Complex scenes → LOD (Level of Detail)
```

## Example: Complete Game Scene

```tsx
import * as THREE from "three/webgpu";
import { View, Text, Pressable } from "react-native";
import { useRef, useState, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { FiberCanvas } from "@/lib/fiber-canvas";

function Player({ position }: { position: THREE.Vector3 }) {
  const ref = useRef<THREE.Mesh>(null!);

  useFrame(() => {
    ref.current.position.copy(position);
  });

  return (
    <mesh ref={ref}>
      <coneGeometry args={[0.5, 1, 8]} />
      <meshStandardMaterial color="#00ffff" />
    </mesh>
  );
}

function GameScene({ playerX }: { playerX: number }) {
  const { camera } = useThree();
  const playerPos = useRef(new THREE.Vector3(0, 0, 0));

  playerPos.current.x = playerX;

  useEffect(() => {
    camera.position.set(0, 10, 15);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} />
      <Player position={playerPos.current} />
    </>
  );
}

export default function Game() {
  const [playerX, setPlayerX] = useState(0);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <FiberCanvas style={{ flex: 1 }}>
        <GameScene playerX={playerX} />
      </FiberCanvas>

      <View style={{ position: "absolute", bottom: 40, flexDirection: "row" }}>
        <Pressable onPress={() => setPlayerX((x) => x - 1)}>
          <Text style={{ color: "#fff", fontSize: 32 }}>◀</Text>
        </Pressable>
        <Pressable onPress={() => setPlayerX((x) => x + 1)}>
          <Text style={{ color: "#fff", fontSize: 32 }}>▶</Text>
        </Pressable>
      </View>
    </View>
  );
}
```
