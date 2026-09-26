---
title: useState Dispatch updaters for State That Depends on Current Value
impact: MEDIUM
impactDescription: avoids stale closures, prevents unnecessary re-renders
tags: state, hooks, useState, callbacks
---

## Use Dispatch Updaters for State That Depends on Current Value

When the next state depends on the current state, use a dispatch updater
(`setState(prev => ...)`) instead of reading the state variable directly in a
callback. This avoids stale closures and ensures you're comparing against the
latest value.

**Incorrect (reads state directly):**

```tsx
const [size, setSize] = useState<Size | undefined>(undefined)

const onLayout = (e: LayoutChangeEvent) => {
  const { width, height } = e.nativeEvent.layout
  // size may be stale in this closure
  if (size?.width !== width || size?.height !== height) {
    setSize({ width, height })
  }
}
```

**Correct (dispatch updater):**

```tsx
const [size, setSize] = useState<Size | undefined>(undefined)

const onLayout = (e: LayoutChangeEvent) => {
  const { width, height } = e.nativeEvent.layout
  setSize((prev) => {
    if (prev?.width === width && prev?.height === height) return prev
    return { width, height }
  })
}
```

Returning the previous value from the updater skips the re-render.

For primitive states, you don't need to compare values before firing a
re-render.

**Incorrect (unnecessary comparison for primitive state):**

```tsx
const [size, setSize] = useState<Size | undefined>(undefined)

const onLayout = (e: LayoutChangeEvent) => {
  const { width, height } = e.nativeEvent.layout
  setSize((prev) => (prev === width ? prev : width))
}
```

**Correct (sets primitive state directly):**

```tsx
const [size, setSize] = useState<Size | undefined>(undefined)

const onLayout = (e: LayoutChangeEvent) => {
  const { width, height } = e.nativeEvent.layout
  setSize(width)
}
```

However, if the next state depends on the current state, you should still use a
dispatch updater.

**Incorrect (reads state directly from the callback):**

```tsx
const [count, setCount] = useState(0)

const onTap = () => {
  setCount(count + 1)
}
```

**Correct (dispatch updater):**

```tsx
const [count, setCount] = useState(0)

const onTap = () => {
  setCount((prev) => prev + 1)
}
```
