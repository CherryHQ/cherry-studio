---
title: Wrap Strings in Text Components
impact: CRITICAL
impactDescription: prevents runtime crash
tags: rendering, text, core
---

## Wrap Strings in Text Components

Strings must be rendered inside `<Text>`. React Native crashes if a string is a
direct child of `<View>`.

**Incorrect (crashes):**

```tsx
import { View } from 'react-native'

function Greeting({ name }: { name: string }) {
  return <View>Hello, {name}!</View>
}
// Error: Text strings must be rendered within a <Text> component.
```

**Correct:**

```tsx
import { View, Text } from 'react-native'

function Greeting({ name }: { name: string }) {
  return (
    <View>
      <Text>Hello, {name}!</Text>
    </View>
  )
}
```
