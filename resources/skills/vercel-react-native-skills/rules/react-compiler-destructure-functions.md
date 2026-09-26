---
title: Destructure Functions Early in Render (React Compiler)
impact: HIGH
impactDescription: stable references, fewer re-renders
tags: rerender, hooks, performance, react-compiler
---

## Destructure Functions Early in Render

This rule is only applicable if you are using the React Compiler.

Destructure functions from hooks at the top of render scope. Never dot into
objects to call functions. Destructured functions are stable references; dotting
creates new references and breaks memoization.

**Incorrect (dotting into object):**

```tsx
import { useRouter } from 'expo-router'

function SaveButton(props) {
  const router = useRouter()

  // bad: react-compiler will key the cache on "props" and "router", which are objects that change each render
  const handlePress = () => {
    props.onSave()
    router.push('/success') // unstable reference
  }

  return <Button onPress={handlePress}>Save</Button>
}
```

**Correct (destructure early):**

```tsx
import { useRouter } from 'expo-router'

function SaveButton({ onSave }) {
  const { push } = useRouter()

  // good: react-compiler will key on push and onSave
  const handlePress = () => {
    onSave()
    push('/success') // stable reference
  }

  return <Button onPress={handlePress}>Save</Button>
}
```
