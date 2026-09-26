# Platform-specific iOS UI: `@expo/ui/swift-ui`

> **iOS only.** Code that imports from `@expo/ui/swift-ui` will crash on Android with "Unable to get view config" errors. Always place this code in an `.ios.tsx` component file or guard it with `Platform.OS === 'ios'`. `Host` must be imported from `@expo/ui` (the universal root), not from `@expo/ui/swift-ui`.

Use this layer only when the universal `@expo/ui` components don't cover what you need on iOS (see `./universal.md` first). This requires a platform-specific tree.

### File placement with Expo Router

**Do not put `.ios.tsx` files inside `app/` or `src/app/`.** Expo Router does not support platform-extension suffixes for route files and will throw a "no fallback sibling" Render Error.

Place platform-specific component files in `components/` (or any directory outside the route tree), then import them from a regular route file:

```
src/components/ProfileEditor.ios.tsx   ← SwiftUI tree lives here
src/app/profile-editor.tsx             ← regular Expo Router route, imports the component
```

`src/app/profile-editor.tsx`:
```tsx
import ProfileEditor from '../components/ProfileEditor';
export default ProfileEditor;
```

Alternatively, keep everything in one regular route file and branch on `Platform.OS`:

```tsx
// src/app/profile-editor.tsx
import { Platform } from 'react-native';
// import SwiftUI components only when on iOS to avoid Android crash
const SwiftUIForm = Platform.OS === 'ios' ? require('../components/ProfileEditor.ios').default : null;
```

Or more simply, put the `Platform.OS` guard and the SwiftUI import in the same route file (safe because Metro only bundles `.ios.tsx` imports on iOS builds when using platform extensions in `components/`).

## Instructions

- Expo UI's API mirrors SwiftUI's API. Use SwiftUI knowledge to decide which components or modifiers to use.
- Components are imported from `@expo/ui/swift-ui`, modifiers from `@expo/ui/swift-ui/modifiers`.
- **Before writing any code, run the list-components script** to get the exact components and modifiers available in the installed version:
  ```bash
  node <skill-root>/scripts/list-components.mjs <project-path>          # names only (compact)
  node <skill-root>/scripts/list-components.mjs <project-path> --docs   # with one-line descriptions
  ```
  (`<skill-root>` is the directory containing this `references/` folder.)
- **The installed package's TypeScript types (`.d.ts`) are the most reliable source of truth** for prop shapes and signatures — read the relevant `{Component}/index.d.ts` from the installed `@expo/ui/swift-ui` package in `node_modules`. Use the docs below as the human-readable reference.
- When about to use a component, fetch its docs to confirm the API — https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/{component-name}/index.md
- When unsure about a modifier's API, refer to the docs — https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/modifiers/index.md
- Every SwiftUI tree must be wrapped in `Host`.
- `RNHostView` is specifically for embedding RN components inside a SwiftUI tree. Example:

```jsx
import { Host } from "@expo/ui";                       // Host always from universal root
import { VStack, RNHostView } from "@expo/ui/swift-ui"; // platform components from swift-ui
import { Pressable } from "react-native";

<Host matchContents>
  <VStack>
    <RNHostView matchContents>
      // Here, `Pressable` is an RN component so it is wrapped in `RNHostView`.
      <Pressable />
    </RNHostView>
  </VStack>
</Host>;
```

- If a required modifier or View is missing in Expo UI, it can be extended via a local Expo module. See: https://docs.expo.dev/guides/expo-ui-swift-ui/extending/index.md. Confirm with the user before extending.

## useNativeState

`useNativeState` creates observable state that updates synchronously on the UI thread via worklets, enabling immediate native state changes without waiting for a React render cycle. Requires `react-native-worklets` — without it updates still go through React and flickering remains. Best for real-time interactions where synchronous updates matter, e.g. a text field that masks or formats input as the user types.

- `ObservableState.value` is readable/writable from worklets; `onChange` fires a worklet listener on state change.
- Docs — https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/usenativestate/index.md
