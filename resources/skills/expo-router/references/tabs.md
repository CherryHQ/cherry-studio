# Native Tabs

Always prefer NativeTabs from 'expo-router/unstable-native-tabs' for the best iOS experience.

**SDK 54+. SDK 55 recommended.**

## SDK Compatibility

| Aspect        | SDK 54                                                  | SDK 55+                                                     |
| ------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| Import        | `import { NativeTabs, Icon, Label, Badge, VectorIcon }` | `import { NativeTabs }` only                                |
| Icon          | `<Icon sf="house.fill" />`                              | `<NativeTabs.Trigger.Icon sf="house.fill" />`               |
| Label         | `<Label>Home</Label>`                                   | `<NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>` |
| Badge         | `<Badge>9+</Badge>`                                     | `<NativeTabs.Trigger.Badge>9+</NativeTabs.Trigger.Badge>`   |
| Android icons | `drawable` prop                                         | `md` prop (Material Symbols)                                |

All examples below use SDK 55 syntax. For SDK 54, replace `NativeTabs.Trigger.Icon/Label/Badge` with standalone `Icon`, `Label`, `Badge` imports.

## Basic Usage

```tsx
import { NativeTabs } from "expo-router/unstable-native-tabs";

export default function TabLayout() {
  return (
    <NativeTabs minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge>9+</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf="gear" md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(search)" role="search">
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```

## Rules

- You must include a trigger for each tab
- The `NativeTabs.Trigger` 'name' must match the route name, including parentheses (e.g. `<NativeTabs.Trigger name="(search)">`)
- Prefer search tab to be last in the list so it can combine with the search bar
- Use the 'role' prop for common tab types
- Tabs must be static — no dynamic addition/removal at runtime (remounts navigator, loses state)

## Platform Features

Native Tabs use platform-specific tab bar implementations:

- **iOS 26+**: Liquid glass effects with system-native appearance
- **Android**: Material 3 bottom navigation
- Better performance and native feel

## Icon Component

```tsx
// SF Symbol (iOS) + Material Symbol (Android)
<NativeTabs.Trigger.Icon sf="house.fill" md="home" />

// State variants
<NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} md="home" />

// Custom image
<NativeTabs.Trigger.Icon src={require('./icon.png')} />

// Xcode asset catalog — iOS only (SDK 55+)
<NativeTabs.Trigger.Icon xcasset="home-icon" />
<NativeTabs.Trigger.Icon xcasset={{ default: "home-outline", selected: "home-filled" }} />

// Rendering mode — iOS only (SDK 55+)
<NativeTabs.Trigger.Icon src={require('./icon.png')} renderingMode="template" />
<NativeTabs.Trigger.Icon src={require('./gradient.png')} renderingMode="original" />
```

`renderingMode`: `"template"` applies tint color (single-color icons), `"original"` preserves source colors (gradients). Android always uses original.

## Label & Badge

```tsx
// Label
<NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
<NativeTabs.Trigger.Label hidden>Home</NativeTabs.Trigger.Label>  {/* icon-only tab */}

// Badge
<NativeTabs.Trigger.Badge>9+</NativeTabs.Trigger.Badge>
<NativeTabs.Trigger.Badge />  {/* dot indicator */}
```

## iOS 26 Features

### Liquid Glass Tab Bar

The tab bar automatically adopts liquid glass appearance on iOS 26+.

### Minimize on Scroll

```tsx
<NativeTabs minimizeBehavior="onScrollDown">
```

### Search Tab

```tsx
<NativeTabs.Trigger name="(search)" role="search">
  <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
</NativeTabs.Trigger>
```

**Note**: Place search tab last for best UX.

### Role Prop

Use semantic roles for special tab types:

```tsx
<NativeTabs.Trigger name="search" role="search" />
<NativeTabs.Trigger name="favorites" role="favorites" />
<NativeTabs.Trigger name="more" role="more" />
```

Available roles: `search` | `more` | `favorites` | `bookmarks` | `contacts` | `downloads` | `featured` | `history` | `mostRecent` | `mostViewed` | `recents` | `topRated`

## Customization

### Tint Color

```tsx
<NativeTabs tintColor="#007AFF">
```

### Dynamic Colors (iOS)

Use DynamicColorIOS for colors that adapt to liquid glass:

```tsx
import { DynamicColorIOS, Platform } from 'react-native';

const adaptiveBlue = Platform.select({
  ios: DynamicColorIOS({ light: '#007AFF', dark: '#0A84FF' }),
  default: '#007AFF',
});

<NativeTabs tintColor={adaptiveBlue}>
```

## Conditional Tabs

```tsx
<NativeTabs.Trigger name="admin" hidden={!isAdmin}>
  <NativeTabs.Trigger.Label>Admin</NativeTabs.Trigger.Label>
  <NativeTabs.Trigger.Icon sf="shield.fill" md="shield" />
</NativeTabs.Trigger>
```

**Don't hide the tabs when they are visible - toggling visibility remounts the navigator; Do it only during the initial render.**

**Note**: Hidden tabs cannot be navigated to!

## Behavior Options

```tsx
<NativeTabs.Trigger
  name="home"
  disablePopToTop           // Don't pop stack when tapping active tab
  disableScrollToTop        // Don't scroll to top when tapping active tab
  disableAutomaticContentInsets  // Opt out of automatic safe area insets (SDK 55+)
>
```

## Hidden Tab Bar (SDK 55+)

Use `hidden` prop on `NativeTabs` to hide the entire tab bar dynamically:

```tsx
<NativeTabs hidden={isTabBarHidden}>{/* triggers */}</NativeTabs>
```

## Bottom Accessory (SDK 55+)

`NativeTabs.BottomAccessory` renders content above the tab bar (iOS 26+). Uses `usePlacement()` to adapt between `'regular'` and `'inline'` layouts.

**Important**: Two instances render simultaneously — store state outside the component (props, context, or external store).

```tsx
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

function MiniPlayer({
  isPlaying,
  onToggle,
}: {
  isPlaying: boolean;
  onToggle: () => void;
}) {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  if (placement === "inline") {
    return (
      <Pressable onPress={onToggle}>
        <SymbolView name={isPlaying ? "pause.fill" : "play.fill"} />
      </Pressable>
    );
  }
  return <View>{/* full player UI */}</View>;
}

export default function TabLayout() {
  const [isPlaying, setIsPlaying] = useState(false);
  return (
    <NativeTabs>
      <NativeTabs.BottomAccessory>
        <MiniPlayer
          isPlaying={isPlaying}
          onToggle={() => setIsPlaying(!isPlaying)}
        />
      </NativeTabs.BottomAccessory>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```

## Safe Area Handling (SDK 55+)

SDK 55 handles safe areas automatically:

- **Android**: Content wrapped in SafeAreaView (bottom inset)
- **iOS**: First ScrollView gets automatic `contentInsetAdjustmentBehavior`

To opt out per-tab, use `disableAutomaticContentInsets` and manage manually:

```tsx
<NativeTabs.Trigger name="index" disableAutomaticContentInsets>
  <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
</NativeTabs.Trigger>
```

```tsx
// In the screen
import { SafeAreaView } from "react-native-screens/experimental";

export default function HomeScreen() {
  return (
    <SafeAreaView edges={{ bottom: true }} style={{ flex: 1 }}>
      {/* content */}
    </SafeAreaView>
  );
}
```

## Using Vector Icons

If you must use @expo/vector-icons instead of SF Symbols:

```tsx
import { NativeTabs } from "expo-router/unstable-native-tabs";
import Ionicons from "@expo/vector-icons/Ionicons";

<NativeTabs.Trigger name="home">
  <NativeTabs.Trigger.VectorIcon vector={Ionicons} name="home" />
  <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
</NativeTabs.Trigger>
```

**Prefer SF Symbols + `md` prop over vector icons for native feel.**

If you are using SDK 55 and later **use the md prop to specify Material Symbols used on Android**.

## Structure with Stacks

Native tabs don't render headers. Nest Stacks inside each tab for navigation headers:

```tsx
// app/(tabs)/_layout.tsx
import { NativeTabs } from "expo-router/unstable-native-tabs";

export default function TabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

// app/(tabs)/(home)/_layout.tsx
import Stack from "expo-router/stack";

export default function HomeStack() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{ title: "Home", headerLargeTitleEnabled: true }}
      />
      <Stack.Screen name="details" options={{ title: "Details" }} />
    </Stack>
  );
}
```

## Custom Web Layout

Use platform-specific files for separate native and web tab layouts:

```
app/
  _layout.tsx          # NativeTabs for iOS/Android
  _layout.web.tsx      # Headless tabs for web (expo-router/ui)
```

Or extract to a component: `components/app-tabs.tsx` + `components/app-tabs.web.tsx`.

## Migration from JS Tabs

### Before (JS Tabs)

```tsx
import { Tabs } from "expo-router";

<Tabs>
  <Tabs.Screen
    name="index"
    options={{
      title: "Home",
      tabBarIcon: ({ color }) => <IconSymbol name="house.fill" color={color} />,
      tabBarBadge: 3,
    }}
  />
</Tabs>;
```

### After (Native Tabs)

```tsx
import { NativeTabs } from "expo-router/unstable-native-tabs";

<NativeTabs>
  <NativeTabs.Trigger name="index">
    <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
    <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
    <NativeTabs.Trigger.Badge>3</NativeTabs.Trigger.Badge>
  </NativeTabs.Trigger>
</NativeTabs>;
```

### Key Differences

| JS Tabs                    | Native Tabs                  |
| -------------------------- | ---------------------------- |
| `<Tabs.Screen>`            | `<NativeTabs.Trigger>`       |
| `options={{ title }}`      | `<NativeTabs.Trigger.Label>` |
| `options={{ tabBarIcon }}` | `<NativeTabs.Trigger.Icon>`  |
| `tabBarBadge` option       | `<NativeTabs.Trigger.Badge>` |
| Props-based API            | Component-based API          |
| Headers built-in           | Nest `<Stack>` for headers   |

## Limitations

- **Android**: Maximum 5 tabs (Material Design constraint)
- **Nesting**: Native tabs cannot nest inside other native tabs
- **Tab bar height**: Cannot be measured programmatically
- **FlatList transparency**: Use `disableTransparentOnScrollEdge` to fix issues
- **Dynamic tabs**: Tabs must be static; changes remount navigator and lose state

## Keyboard Handling (Android)

Configure in app.json:

```json
{
  "expo": {
    "android": {
      "softwareKeyboardLayoutMode": "resize"
    }
  }
}
```

## Common Issues

1. **Icons not showing on Android**: Add `md` prop (SDK 55) or use VectorIcon
2. **Headers missing**: Nest a Stack inside each tab group
3. **Trigger name mismatch**: `name` must match exact route name including parentheses
4. **Badge not visible**: Badge must be a child of Trigger, not a prop
5. **Tab bar transparent on iOS 18 and earlier**: If the screen uses a `ScrollView` or `FlatList`, make sure it is the first opaque child of the screen component. If it needs to be wrapped in another `View`, ensure the wrapper uses `collapsable={false}`. If the screen does not use a `ScrollView` or `FlatList`, set `disableTransparentOnScrollEdge` to `true` in the `NativeTabs.Trigger` options, to make the tab bar opaque.
6. **Scroll to top not working**: Ensure `disableScrollToTop` is not set on the active tab's Trigger and `ScrollView` is the first child of the screen component.
7. **Header buttons flicker when navigating between tabs**: Make sure the app is wrapped in a `ThemeProvider`

```tsx
import {
  ThemeProvider,
  DarkTheme,
  DefaultTheme,
} from "expo-router/react-navigation";
import { useColorScheme } from "react-native";
import { Stack } from "expo-router";

export default function Layout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack />
    </ThemeProvider>
  );
}
```

If the app only uses a light or dark theme, you can directly pass `DarkTheme` or `DefaultTheme` to `ThemeProvider` without checking the color scheme.

```tsx
import { ThemeProvider, DarkTheme } from "expo-router/react-navigation";
import { Stack } from "expo-router";

export default function Layout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <Stack />
    </ThemeProvider>
  );
}
```
