# Route Structure

## File Conventions

- Routes belong in the `app` directory
- Use `[]` for dynamic routes, e.g. `[id].tsx`
- Routes can never be named `(foo).tsx` - use `(foo)/index.tsx` instead
- Use `(group)` routes to simplify the public URL structure
- NEVER co-locate components, types, or utilities in the app directory - these should be in separate directories like `components/`, `utils/`, etc.
- The app directory should only contain route and `_layout` files; every file should export a default component
- Ensure the app always has a route that matches "/" so the app is never blank
- ALWAYS use `_layout.tsx` files to define stacks

## Dynamic Routes

Use square brackets for dynamic segments:

```
app/
  users/
    [id].tsx        # Matches /users/123, /users/abc
    [id]/
      posts.tsx     # Matches /users/123/posts
```

### Catch-All Routes

Use `[...slug]` for catch-all routes:

```
app/
  docs/
    [...slug].tsx   # Matches /docs/a, /docs/a/b, /docs/a/b/c
```

## Query Parameters

Access query parameters with the `useLocalSearchParams` hook:

```tsx
import { useLocalSearchParams } from "expo-router";

function Page() {
  const { id } = useLocalSearchParams<{ id: string }>();
}
```

For dynamic routes, the parameter name matches the file name:

- `[id].tsx` → `useLocalSearchParams<{ id: string }>()`
- `[slug].tsx` → `useLocalSearchParams<{ slug: string }>()`

## Pathname

Access the current pathname with the `usePathname` hook:

```tsx
import { usePathname } from "expo-router";

function Component() {
  const pathname = usePathname(); // e.g. "/users/123"
}
```

## Group Routes

Use parentheses for groups that don't affect the URL:

```
app/
  (auth)/
    login.tsx       # URL: /login
    register.tsx    # URL: /register
  (main)/
    index.tsx       # URL: /
    settings.tsx    # URL: /settings
```

Groups are useful for:

- Organizing related routes
- Applying different layouts to route groups
- Keeping URLs clean

## Stacks and Tabs Structure

When an app has tabs, the header and title should be set in a Stack that is nested INSIDE each tab. This allows tabs to have their own headers and distinct histories. The root layout should often not have a header.

- Set the 'headerShown' option to false on the tab layout
- Use (group) routes to simplify the public URL structure
- You may need to delete or refactor existing routes to fit this structure

Example structure:

```
app/
  _layout.tsx — <Tabs />
  (home)/
    _layout.tsx — <Stack />
    index.tsx — <ScrollView />
  (settings)/
    _layout.tsx — <Stack />
    index.tsx — <ScrollView />
  (home,settings)/
    info.tsx — <ScrollView /> (shared across tabs)
```

## Array Routes for Multiple Stacks

Use array routes '(index,settings)' to create multiple stacks. This is useful for tabs that need to share screens across stacks.

```
app/
  _layout.tsx — <Tabs />
  (index,settings)/
    _layout.tsx — <Stack />
    index.tsx — <ScrollView />
    settings.tsx — <ScrollView />
```

This requires a specialized layout with explicit anchor routes:

```tsx
// app/(index,settings)/_layout.tsx
import { useMemo } from "react";
import Stack from "expo-router/stack";

export const unstable_settings = {
  index: { anchor: "index" },
  settings: { anchor: "settings" },
};

export default function Layout({ segment }: { segment: string }) {
  const screen = segment.match(/\((.*)\)/)?.[1]!;

  const options = useMemo(() => {
    switch (screen) {
      case "index":
        return { headerRight: () => <></> };
      default:
        return {};
    }
  }, [screen]);

  return (
    <Stack>
      <Stack.Screen name={screen} options={options} />
    </Stack>
  );
}
```

## Complete App Structure Example

```
app/
  _layout.tsx — <NativeTabs />
  (index,search)/
    _layout.tsx — <Stack />
    index.tsx — Main list
    search.tsx — Search view
    i/[id].tsx — Detail page
components/
  theme.tsx
  list.tsx
utils/
  storage.ts
  use-search.ts
```

## Layout Files

Every directory can have a `_layout.tsx` file that wraps all routes in that directory:

```tsx
// app/_layout.tsx
import { Stack } from "expo-router/stack";

export default function RootLayout() {
  return <Stack />;
}
```

```tsx
// app/(tabs)/_layout.tsx
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";

export default function TabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Label>Home</Label>
        <Icon sf="house.fill" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```

## Route Settings

Export `unstable_settings` to configure route behavior:

```tsx
export const unstable_settings = {
  anchor: "index",
};
```

- `initialRouteName` was renamed to `anchor` in v4

## Not Found Routes

Create a `+not-found.tsx` file to handle unmatched routes:

```tsx
// app/+not-found.tsx
import { Link } from "expo-router";
import { View, Text } from "react-native";

export default function NotFound() {
  return (
    <View>
      <Text>Page not found</Text>
      <Link href="/">Go home</Link>
    </View>
  );
}
```
