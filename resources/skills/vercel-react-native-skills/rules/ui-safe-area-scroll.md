---
title: Use contentInsetAdjustmentBehavior for Safe Areas
impact: MEDIUM
impactDescription: native safe area handling, no layout shifts
tags: safe-area, scrollview, layout
---

## Use contentInsetAdjustmentBehavior for Safe Areas

Use `contentInsetAdjustmentBehavior="automatic"` on the root ScrollView instead of wrapping content in SafeAreaView or manual padding. This lets iOS handle safe area insets natively with proper scroll behavior.

**Incorrect (SafeAreaView wrapper):**

```tsx
import { SafeAreaView, ScrollView, View, Text } from 'react-native'

function MyScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView>
        <View>
          <Text>Content</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
```

**Incorrect (manual safe area padding):**

```tsx
import { ScrollView, View, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

function MyScreen() {
  const insets = useSafeAreaInsets()

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top }}>
      <View>
        <Text>Content</Text>
      </View>
    </ScrollView>
  )
}
```

**Correct (native content inset adjustment):**

```tsx
import { ScrollView, View, Text } from 'react-native'

function MyScreen() {
  return (
    <ScrollView contentInsetAdjustmentBehavior='automatic'>
      <View>
        <Text>Content</Text>
      </View>
    </ScrollView>
  )
}
```

The native approach handles dynamic safe areas (keyboard, toolbars) and allows content to scroll behind the status bar naturally.
