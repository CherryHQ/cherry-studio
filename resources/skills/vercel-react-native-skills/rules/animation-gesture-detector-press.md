---
title: Use GestureDetector for Animated Press States
impact: MEDIUM
impactDescription: UI thread animations, smoother press feedback
tags: animation, gestures, press, reanimated
---

## Use GestureDetector for Animated Press States

For animated press states (scale, opacity on press), use `GestureDetector` with
`Gesture.Tap()` and shared values instead of Pressable's
`onPressIn`/`onPressOut`. Gesture callbacks run on the UI thread as worklets—no
JS thread round-trip for press animations.

**Incorrect (Pressable with JS thread callbacks):**

```tsx
import { Pressable } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated'

function AnimatedButton({ onPress }: { onPress: () => void }) {
  const scale = useSharedValue(1)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => (scale.value = withTiming(0.95))}
      onPressOut={() => (scale.value = withTiming(1))}
    >
      <Animated.View style={animatedStyle}>
        <Text>Press me</Text>
      </Animated.View>
    </Pressable>
  )
}
```

**Correct (GestureDetector with UI thread worklets):**

```tsx
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  runOnJS,
} from 'react-native-reanimated'

function AnimatedButton({ onPress }: { onPress: () => void }) {
  // Store the press STATE (0 = not pressed, 1 = pressed)
  const pressed = useSharedValue(0)

  const tap = Gesture.Tap()
    .onBegin(() => {
      pressed.set(withTiming(1))
    })
    .onFinalize(() => {
      pressed.set(withTiming(0))
    })
    .onEnd(() => {
      runOnJS(onPress)()
    })

  // Derive visual values from the state
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(withTiming(pressed.get()), [0, 1], [1, 0.95]) },
    ],
  }))

  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={animatedStyle}>
        <Text>Press me</Text>
      </Animated.View>
    </GestureDetector>
  )
}
```

Store the press **state** (0 or 1), then derive the scale via `interpolate`.
This keeps the shared value as ground truth. Use `runOnJS` to call JS functions
from worklets. Use `.set()` and `.get()` for React Compiler compatibility.

Reference:
[Gesture Handler Tap Gesture](https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/tap-gesture)
