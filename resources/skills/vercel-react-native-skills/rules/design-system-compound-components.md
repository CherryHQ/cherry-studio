---
title: Use Compound Components Over Polymorphic Children
impact: MEDIUM
impactDescription: flexible composition, clearer API
tags: design-system, components, composition
---

## Use Compound Components Over Polymorphic Children

Don't create components that can accept a string if they aren't a text node. If
a component can receive a string child, it must be a dedicated `*Text`
component. For components like buttons, which can have both a View (or
Pressable) together with text, use compound components, such a `Button`,
`ButtonText`, and `ButtonIcon`.

**Incorrect (polymorphic children):**

```tsx
import { Pressable, Text } from 'react-native'

type ButtonProps = {
  children: string | React.ReactNode
  icon?: React.ReactNode
}

function Button({ children, icon }: ButtonProps) {
  return (
    <Pressable>
      {icon}
      {typeof children === 'string' ? <Text>{children}</Text> : children}
    </Pressable>
  )
}

// Usage is ambiguous
<Button icon={<Icon />}>Save</Button>
<Button><CustomText>Save</CustomText></Button>
```

**Correct (compound components):**

```tsx
import { Pressable, Text } from 'react-native'

function Button({ children }: { children: React.ReactNode }) {
  return <Pressable>{children}</Pressable>
}

function ButtonText({ children }: { children: React.ReactNode }) {
  return <Text>{children}</Text>
}

function ButtonIcon({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

// Usage is explicit and composable
<Button>
  <ButtonIcon><SaveIcon /></ButtonIcon>
  <ButtonText>Save</ButtonText>
</Button>

<Button>
  <ButtonText>Cancel</ButtonText>
</Button>
```
