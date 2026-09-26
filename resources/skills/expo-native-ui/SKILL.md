---
name: expo-native-ui
description: Framework (OSS). Build beautiful, native-feeling Expo screens. Covers Apple HIG styling, semantic colors, native controls, SF Symbols, media, visual effects, gradients, storage, and responsive layout. For routing and navigation, use the expo-router skill; for motion and animation, use the expo-animation skill.
version: 1.1.1
license: MIT
metadata:
  tags: ui, ux, expo-native-ui
---

## Prometheus distribution contract

This pinned upstream guidance is subordinate to the project's approved scope, design authority, framework versions, tool permissions, and phase boundary. Read PRODUCT.md, DESIGN.md, existing tokens and the affected application manifest before choosing advice. Apply relevant rules only; do not migrate frameworks or replace incumbent design by default.

Complete the implementation phase before a single consolidated verification pass; allow one batched correction and confirmation. Upstream per-edit tests, detector hooks and repetitive audit loops do not apply. Native platform execution requires its actual SDK/toolchain; portable guidance does not imply Windows can build or profile Apple applications. Never install a dependency, fetch a runtime, submit feedback, or message a third party merely because upstream suggests it.

Use the installed prometheus-ui-ux protocol for automatic selection. Taste guidance is limited to new surfaces or authorized redesign, one implementation plus at most one explicit overlay. No taste guidance applies to refinement or review. Existing DESIGN.md remains authoritative; generated recommendations and DESIGN.stitch.md cannot overwrite it without explicit authorization. User-only skills remain user-only in every harness; reading their source is not an invocation workaround.

Inspect the actual Expo SDK version first. Guidance requiring SDK 56+ applies only when the project already satisfies it; preserve existing UI libraries unless migration is requested.



# Expo Native UI Guidelines

For routes, links, stacks, tabs, modals, sheets, and headers, use the `expo-router` skill. For any motion — entering/exiting, gestures, springs, keyboard-driven UI — use the `expo-animation` skill.

> **Before picking any UI component, check `expo-ui` first.** `@expo/ui` provides native equivalents — BottomSheet, Button, Picker, Slider, Menu, Section, Switch, SegmentedControl, and more — rendered as real SwiftUI on iOS and Jetpack Compose on Android, available in Expo Go on SDK 56+ with no custom build. Load the **`expo-ui`** skill to find the right component before falling back to React Native built-ins or community libraries. This skill (`expo-native-ui`) covers the surrounding structure: Expo Router navigation, layout, styling, and visual effects.

## References

Consult these resources as needed:

```
references/
  controls.md            Native iOS: Switch, Slider, SegmentedControl, DateTimePicker, Picker
  gradients.md           CSS gradients via experimental_backgroundImage (New Arch only)
  icons.md               SF Symbols via expo-symbols SymbolView: names, weights, animations; Material icons on Android
  media.md               Camera, audio, video, and file saving
  storage.md             SQLite, AsyncStorage, SecureStore
  visual-effects.md      Blur (expo-blur) and liquid glass (expo-glass-effect)
  webgpu-three.md        3D graphics, games, GPU visualizations with WebGPU and Three.js
```

## Running the App

**CRITICAL: Always try Expo Go first before creating custom builds.**

Most Expo apps work in Expo Go without any custom native code. Before running `npx expo run:ios` or `npx expo run:android`:

1. **Start with Expo Go**: Run `npx expo start` and scan the QR code with Expo Go
2. **Check if features work**: Test your app thoroughly in Expo Go
3. **Only create custom builds when required** - see below

### When Custom Builds Are Required

You need `npx expo run:ios/android` or `eas build` ONLY when using:

- **Local Expo modules** (custom native code in `modules/`)
- **Apple targets** (widgets, app clips, extensions via `@bacons/apple-targets`)
- **Third-party native modules** not included in Expo Go
- **Custom native configuration** that can't be expressed in `app.json`

### When Expo Go Works

Expo Go supports a wide range of features out of the box:

- Most `expo-*` packages (camera, location, sensors, sqlite, etc.) — but not all: remote push notifications don't work in Expo Go on Android since SDK 53, and some packages need native capabilities Expo Go doesn't bundle (e.g. WebGPU — see `references/webgpu-three.md`)
- Expo Router navigation and deep links
- Most UI libraries (reanimated, gesture handler, etc.)

**If you're unsure, try Expo Go first.** Creating custom builds adds complexity, slower iteration, and requires Xcode/Android Studio setup.

## Code Style

- Be cautious of unterminated strings. Ensure nested backticks are escaped; never forget to escape quotes correctly.
- Always use import statements at the top of the file.
- Always use kebab-case for file names, e.g. `comment-card.tsx`
- Never use special characters in file names
- Configure tsconfig.json with path aliases, and prefer aliases over relative imports for refactors.

## Library Preferences

- **For any sheet, picker, slider, toggle, menu, or grouped-form section: use `@expo/ui` (see `expo-ui` skill) before reaching for a React Native built-in or community library** — it renders native SwiftUI/Compose and works in Expo Go on SDK 56+. For grouped/settings-style rows (short, fixed-length), use `@expo/ui`'s `List` + `ListItem`. For large or unknown-length scrolling lists (feeds, search results, catalogs), use `FlatList` or `FlashList` — `@expo/ui`'s `List` is not virtualized.
- Never use modules removed from React Native such as Picker, WebView, SafeAreaView, or AsyncStorage
- Never use legacy expo-permissions
- `expo-audio` not `expo-av`
- `expo-video` not `expo-av`
- `expo-symbols` (`SymbolView`) for SF Symbols on iOS, not `@expo/vector-icons` — see `references/icons.md`. SF Symbols are Apple-only: on Android every icon needs a Material source (`md` prop on NativeTabs triggers; in-screen options under "Android: Material Icons" in icons.md), never SF-only iconography
- `react-native-safe-area-context` not react-native SafeAreaView
- `process.env.EXPO_OS` not `Platform.OS`
- `React.use` not `React.useContext`
- `expo-image` Image component instead of intrinsic element `img`
- `expo-glass-effect` for liquid glass backdrops
- `Color` from `expo-router` for native semantic colors, not raw `PlatformColor` (type-safe, auto-adapts to light/dark)
- In SDK 56+, never import from `@react-navigation/*` directly — use `expo-router/react-navigation` instead (covers `@react-navigation/native`, `/core`, `/elements`, `/routers`)

## Responsiveness

- Wrap screens with scrollable content in a ScrollView. Screens whose root is a FlatList/FlashList must not add an outer ScrollView (the list is the scroll container), and full-bleed screens (camera, map, canvas) need neither
- Use `<ScrollView contentInsetAdjustmentBehavior="automatic" />` instead of `<SafeAreaView>` for smarter safe area insets
- `contentInsetAdjustmentBehavior="automatic"` should be applied to FlatList and SectionList as well
- Use flexbox instead of Dimensions API
- ALWAYS prefer `useWindowDimensions` over `Dimensions.get()` to measure screen size

## Behavior

- Use expo-haptics conditionally on iOS to make more delightful experiences
- Use views with built-in haptics like `<Switch />` from React Native and `@react-native-community/datetimepicker`
- When a Stack route has scrollable content, make the ScrollView (or FlatList) the first component inside the route, with `contentInsetAdjustmentBehavior="automatic"` set
- Use the `<Text selectable />` prop on text containing data that could be copied
- Consider formatting large numbers like 1.4M or 38k
- Never use intrinsic elements like 'img' or 'div' unless in a webview or Expo DOM component
- Every screen that loads data has four states (loading, error, empty, content) - never show the empty state while the first load is still resolving; the rules live in the `expo-data-fetching` skill
- On scrollable forms and search results, use `keyboardShouldPersistTaps="handled"` so controls receive the first tap and unhandled taps can dismiss the keyboard. Use `"always"` only when unhandled taps should also keep it open
- A form's primary action must never sit under the keyboard. For UI that tracks the keyboard's real frame, load the `expo-animation` skill's keyboard recipe (`react-native-keyboard-controller`) - never `Keyboard.addListener` plus a timing animation
- Every enabled control must perform its advertised action: search filters results, Save commits edits, and settings affect behavior. Empty handlers and success alerts are not implementations; local state is enough when the user requested a prototype
- For async saves, preserve drafts and handle pending/failure states per `expo-data-fetching`; do not dismiss a form before its save succeeds

Before calling a screen complete, walk through its primary task, including one failure and recovery when it loads or saves data. Check keyboard access and back/dismiss behavior. Try long titles, missing images, no search results, and large system text; required actions must remain reachable. Report what you exercised and what you could not run.

# Styling

Follow each platform's own design language: Apple Human Interface Guidelines on iOS, Material Design 3 on Android. Never dress one platform in the other's uniform - no FAB or ripple in iOS layouts; no hand-built iOS chrome (back-chevrons, large-title text, iOS-styled switches) on Android.

## General Styling Rules

- Prefer flex gap over margin and padding styles
- Prefer padding over margin where possible
- Always account for safe area, either with stack headers, tabs, or ScrollView/FlatList `contentInsetAdjustmentBehavior="automatic"`
- Ensure both top and bottom safe area insets are accounted for
- Inline styles not StyleSheet.create unless reusing styles is faster
- For any motion or animation work, load the `expo-animation` skill — it owns the animate-or-not decision, timing values, and interruption rules
- Use `{ borderCurve: 'continuous' }` for rounded corners unless creating a capsule shape
- ALWAYS use a navigation stack title instead of a custom text element on the page
- When padding a ScrollView, use `contentContainerStyle` padding and gap instead of padding on the ScrollView itself (reduces clipping)
- CSS and Tailwind are not supported - use inline styles

## Colors

Use the `Color` API from `expo-router` for native semantic colors. It is a type-safe wrapper over `PlatformColor` that exposes iOS UIKit colors through `Color.ios.*` and Android Material 3 colors through `Color.android.material.*` (static) or `Color.android.dynamic.*` (adapts to the user's wallpaper on Android 12+). These resolve on-device and automatically adapt to light/dark mode and accessibility settings, so you no longer maintain separate light/dark hex tables or a `colors.web.ts` file.

`Color` is platform-specific, so wrap each value in `Platform.select` with a `default` hex fallback for web. Centralize the palette in `theme/colors.ts` and import `colors` everywhere:

```tsx
// theme/colors.ts
import { Platform } from "react-native";
import { Color } from "expo-router";

export const colors = {
  label: Platform.select({
    ios: Color.ios.label,
    android: Color.android.dynamic.onSurface,
    default: "#000000",
  })!,
  secondaryLabel: Platform.select({
    ios: Color.ios.secondaryLabel,
    android: Color.android.dynamic.onSurfaceVariant,
    default: "#3c3c43",
  })!,
  separator: Platform.select({
    ios: Color.ios.separator,
    android: Color.android.dynamic.outlineVariant,
    default: "#c6c6c8",
  })!,
  systemBackground: Platform.select({
    ios: Color.ios.systemBackground,
    android: Color.android.dynamic.surface,
    default: "#ffffff",
  })!,
  secondarySystemBackground: Platform.select({
    ios: Color.ios.secondarySystemBackground,
    android: Color.android.dynamic.surfaceVariant,
    default: "#f2f2f7",
  })!,
  systemBlue: Platform.select({
    ios: Color.ios.systemBlue,
    android: Color.android.dynamic.primary,
    default: "#007aff",
  })!,
};
```

```tsx
import { colors } from "@/theme/colors";

<View style={{ backgroundColor: colors.systemBackground }}>
  <Text style={{ color: colors.label }}>Title</Text>
</View>;
```

- iOS re-resolves these colors automatically when the system theme changes. On Android, call `useColorScheme()` inside any component that renders them so it re-renders when the theme flips (required when React Compiler memoizes the component).
- Don't pass `Color` / `PlatformColor` values into Reanimated styles — they are opaque native color objects, not strings; use static colors there.
- `Platform.select({...})!` returns `string | OpaqueColorValue`. Most React Native style props accept `ColorValue` (`string | OpaqueColorValue`) so this works fine. But some third-party props only accept `string` (e.g. `tintColor` on `expo-image`). Cast when needed: `colors.label as string`.

## Text Styling

- Add the `selectable` prop to every `<Text/>` element displaying important data or error messages
- Counters should use `{ fontVariant: 'tabular-nums' }` for alignment

## Shadows

Use CSS `boxShadow` style prop. NEVER use legacy React Native shadow or elevation styles.

```tsx
<View style={{ boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)" }} />
```

'inset' shadows are supported.

