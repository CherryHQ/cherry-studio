---
name: expo-ui
description: "Framework (OSS). Build native UI with the @expo/ui package: real SwiftUI on iOS and Jetpack Compose on Android. Default to @expo/ui for sheets (BottomSheet), pickers, sliders, toggles, menus, and grouped-form sections — do NOT reach for Reanimated, @gorhom/bottom-sheet, or RN built-in Picker/Switch; use @expo/ui instead. Fall back to RN built-ins only when @expo/ui is missing the component. NOTE: @expo/ui List renders native grouped rows like an iOS Settings screen — it is NOT a virtualized list; use FlatList/FlashList for large datasets. Covers universal components (Host, Column, Row, Button, Text, List, BottomSheet, FieldGroup, Switch, Slider, Picker, Menu), drop-in replacements for RN community libraries, and platform-specific SwiftUI/Jetpack Compose trees. Not for Expo Router navigation, Reanimated, or data fetching."
version: 1.0.0
license: MIT
metadata:
  tags: ui, ux, expo-ui
---

## Prometheus distribution contract

This pinned upstream guidance is subordinate to the project's approved scope, design authority, framework versions, tool permissions, and phase boundary. Read PRODUCT.md, DESIGN.md, existing tokens and the affected application manifest before choosing advice. Apply relevant rules only; do not migrate frameworks or replace incumbent design by default.

Complete the implementation phase before a single consolidated verification pass; allow one batched correction and confirmation. Upstream per-edit tests, detector hooks and repetitive audit loops do not apply. Native platform execution requires its actual SDK/toolchain; portable guidance does not imply Windows can build or profile Apple applications. Never install a dependency, fetch a runtime, submit feedback, or message a third party merely because upstream suggests it.

Use the installed prometheus-ui-ux protocol for automatic selection. Taste guidance is limited to new surfaces or authorized redesign, one implementation plus at most one explicit overlay. No taste guidance applies to refinement or review. Existing DESIGN.md remains authoritative; generated recommendations and DESIGN.stitch.md cannot overwrite it without explicit authorization. User-only skills remain user-only in every harness; reading their source is not an invocation workaround.

Inspect the actual Expo SDK version first. Guidance requiring SDK 56+ applies only when the project already satisfies it; preserve existing UI libraries unless migration is requested.



# Expo UI (`@expo/ui`)

`@expo/ui` renders real native UI from React: SwiftUI on iOS, Jetpack Compose on Android. It also ships drop-in replacements for migrating off RN community UI libraries.

> These instructions track the latest Expo SDK. The **universal** layer requires **SDK 56+** and works in Expo Go — no custom build needed. Drop-in replacements and the platform-specific layers also exist on SDK 55. For component details on a specific SDK, refer to the Expo UI docs for that version.

## Installation

```bash
npx expo install @expo/ui
```

Every `@expo/ui` tree — universal or platform-specific — must be wrapped in `Host`.

## Use @expo/ui by default — don't reach for RN alternatives first

**Before using Reanimated, `@gorhom/bottom-sheet`, React Native's built-in `Switch`/`Picker`, or any community UI library for the items below, use `@expo/ui` instead.** Only fall back to RN built-ins when `@expo/ui` is missing the component.

| Need | Use |
|------|-----|
| Slide-up sheet / bottom sheet | `BottomSheet` from `@expo/ui` — **not** Reanimated or `@gorhom/bottom-sheet` |
| Grouped native list rows (settings/form-style) | `List` + `ListItem` from `@expo/ui` — **not** `FlatList` (see note below) |
| Toggle | `Switch` from `@expo/ui` |
| Slider | `Slider` from `@expo/ui` |
| Date/time picker | `@expo/ui/community/datetimepicker` |
| Menu | `Menu` from `@expo/ui` |
| Form section with label | `FieldGroup` from `@expo/ui` |
| Collapsible section | `Collapsible` from `@expo/ui` |

> **`List` is NOT a virtualized scrolling list.** It renders native grouped table rows — the visual look of an iOS Settings screen or a form section, with disclosure indicators and native row styling. Each `ListItem` is a native node on the JS thread; rows are not recycled. For any list with large or unknown-length data (feeds, search results, catalogs), use **`FlatList`** or **`FlashList`** instead. `List` is the right choice for short, fixed-length groups: a settings screen, a detail panel's rows, a fixed menu.

**`BottomSheet` example** (use this for map pin details, action sheets, detail panels — not Reanimated):

```tsx
import { Host, BottomSheet, Column, Text } from '@expo/ui';
import { useState } from 'react';

export default function MapScreen() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      <MapView onMarkerPress={() => setIsOpen(true)} />
      <Host>
        <BottomSheet
          isPresented={isOpen}
          onDismiss={() => setIsOpen(false)}
          snapPoints={['half', 'full']}
        >
          <Column>
            <Text>Café name</Text>
            <Text>Address</Text>
          </Column>
        </BottomSheet>
      </Host>
    </View>
  );
}
```

`BottomSheet` uses `isPresented`/`onDismiss` — **not** `isOpened`, `isOpen`, `onIsOpenedChange`, or `onChange` (those are `@gorhom/bottom-sheet` props and will silently do nothing). `snapPoints` accepts `'half'`, `'full'`, `{ fraction: 0.5 }`, or `{ height: 400 }` and is optional (auto-sizes to content when omitted).

## Choosing an approach

Work down this list and stop at the first layer that meets the need:

1. **Universal components — start here.** Import from the `@expo/ui` root. One component tree runs unmodified on iOS, Android, and web from a single source (Compose on Android, SwiftUI on iOS, `react-native-web`/`react-dom` on web). No platform file splits. → `./references/universal.md`

2. **Platform-specific (SwiftUI / Jetpack Compose).** Import from `@expo/ui/swift-ui` or `@expo/ui/jetpack-compose`. Use **only** when the universal layer is missing a component or modifier you need, or when you need platform-specific behavior or optimization. **Downside:** you write two trees and split them into `.ios.tsx` / `.android.tsx` files (or branch on `Platform.OS`) — more code to maintain.

   > **`@expo/ui/swift-ui` is iOS-only. `@expo/ui/jetpack-compose` is Android-only.** Importing either in a file that runs on the other platform will crash at runtime with "Unable to get view config" errors. Isolate platform-specific trees in `.ios.tsx` / `.android.tsx` files placed in `components/` (never inside `app/` — Expo Router does not support platform extensions for route files), or guard with `Platform.OS` in a regular route file. `Host` must always be imported from `@expo/ui` (the universal package root), not from the platform-specific sub-packages. → `./references/swift-ui.md` and `./references/jetpack-compose.md`

**Already using an RN community UI library?** `@expo/ui` also ships **drop-in replacements** — API-compatible swaps for popular libraries (`@gorhom/bottom-sheet`, `@react-native-community/datetimepicker`, and more), imported from `@expo/ui/community/<name>`. This is a migration side-path for replacing an existing dependency, not a step in the universal-vs-platform decision above. → `./references/drop-in-replacements.md`

## References

Consult these resources as needed:

```
references/
  universal.md             Universal @expo/ui components and when to use them (SDK 56+)
  drop-in-replacements.md  API-compatible replacements for RN community UI libraries
  swift-ui.md              Platform-specific iOS UI: @expo/ui/swift-ui components, modifiers, RNHostView, useNativeState
  jetpack-compose.md       Platform-specific Android UI: @expo/ui/jetpack-compose components, modifiers, LazyColumn caveat, icons, useNativeState
```

