# Universal `@expo/ui` components

> Requires Expo SDK 56+.

Universal components are a single-API layer over the platform-native UI toolkits: Jetpack Compose on Android, SwiftUI on iOS, and `react-native-web` / `react-dom` on web. You write one component tree that runs unmodified on all three platforms while keeping a native look and feel — no `.ios.tsx` / `.android.tsx` split.

## Usage

Import everything, including `Host`, from the package root (`@expo/ui`). Every tree must be wrapped in `Host`.

```tsx
import { Host, Column, Button, Text } from '@expo/ui';

<Host matchContents>
  <Column>
    <Text>Hello</Text>
    <Button onPress={() => alert('Pressed!')}>Press me</Button>
  </Column>
</Host>;
```

## Components

| Category | Components |
|----------|------------|
| Container | `Host` (required root wrapper) |
| Layout | `Column`, `Row`, `Spacer`, `ScrollView` |
| Display | `Text`, `Icon` |
| Controls | `Button`, `Switch`, `Checkbox`, `Slider`, `TextInput`, `Picker` |
| Disclosure & presentation | `BottomSheet`, `Collapsible` |
| Collections & forms | `List` (with `ListItem`), `FieldGroup` |

> **`List` is not suitable for large lists.** Each `ListItem` is a JSX node processed on the JS thread — for large datasets this causes noticeable slowdowns.

## TextInput and useNativeState

`TextInput` from `@expo/ui` is **not like React Native's TextInput** — its `value` and `selection` props take an `ObservableState` object (from `useNativeState`), not a plain string. This is what enables synchronous, flicker-free updates: when the user types, `onChangeText` runs as a worklet on the UI thread and writes directly to `value` without a React render cycle.

Requires `react-native-worklets`. Without it the worklet directive has no effect and flickering remains.

```tsx
import { Host, TextInput, useNativeState } from '@expo/ui';
import { useCallback } from 'react';

export default function MyInput() {
  const text = useNativeState('');

  const handleChangeText = useCallback((value: string) => {
    'worklet';
    // transform synchronously on the UI thread — no React re-render
    text.value = value === 'Hello' ? 'World' : value;
  }, [text]);

  return (
    <Host matchContents>
      <TextInput value={text} onChangeText={handleChangeText} placeholder="Type here" />
    </Host>
  );
}
```

Docs — https://docs.expo.dev/versions/latest/sdk/ui/universal/textinput/index.md

## BottomSheet

`BottomSheet` is a universal slide-up sheet. Control it with `isPresented` / `onDismiss` — **not** `isOpen`, `isOpened`, `onIsOpenedChange`, or `onChange` (those belong to other sheet APIs; the universal `BottomSheet` does not accept them). `snapPoints` is optional and accepts `'half'`, `'full'`, `{ fraction }`, or `{ height }`; when omitted the sheet auto-sizes to its content.

```tsx
import { Host, BottomSheet, Column, Button, Text } from '@expo/ui';
import { useState } from 'react';

export default function MapScreen() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Host>
      <Button onPress={() => setIsOpen(true)}>Show details</Button>
      <BottomSheet
        isPresented={isOpen}
        onDismiss={() => setIsOpen(false)}
        snapPoints={['half', 'full']}
      >
        <Column>
          <Text>Sheet content</Text>
          <Button onPress={() => setIsOpen(false)}>Close</Button>
        </Column>
      </BottomSheet>
    </Host>
  );
}
```

> **Don't confuse the universal `BottomSheet` with the drop-in `@gorhom/bottom-sheet` replacement** (`@expo/ui/community/bottom-sheet`). They are different components with different APIs. Use the universal one when building new UI; use the drop-in only when migrating an existing `@gorhom/bottom-sheet` integration. See `./drop-in-replacements.md`.

## Confirming the API

`@expo/ui` is versioned with the Expo SDK (e.g. `56.0.x` for SDK 56) and its API can change between SDK versions, so the **installed package's TypeScript types (`.d.ts`) are the most reliable source of truth** — they match the version in your project, while the docs track latest. Read the relevant component's `.d.ts` from the installed `@expo/ui` package in `node_modules`. Use the docs as the human-readable reference:

- Overview — https://docs.expo.dev/versions/latest/sdk/ui/universal/index.md
- Per component — https://docs.expo.dev/versions/latest/sdk/ui/universal/{component-name}/index.md

## When to drop down to a platform-specific layer

Choose universal components whenever they cover the requirement. Drop down to `@expo/ui/swift-ui` or `@expo/ui/jetpack-compose` only when the universal API doesn't expose the component, modifier, or platform-specific behavior you need — accepting the per-platform file split that requires. See `./swift-ui.md` and `./jetpack-compose.md`.
