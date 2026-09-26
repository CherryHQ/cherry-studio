# Toolbars and headers

Add native iOS toolbar items to Stack screens. Items can be placed in the header (left/right) or in a bottom toolbar area.

**Important:** iOS only. Available in Expo SDK 55+.

## Notes app example

```tsx
import { Stack } from "expo-router";
import { ScrollView } from "react-native";

export default function FoldersScreen() {
  return (
    <>
      {/* ScrollView must be the first child of the screen */}
      <ScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Screen content */}
      </ScrollView>
      <Stack.Screen.Title large>Folders</Stack.Screen.Title>
      <Stack.SearchBar placeholder="Search" onChangeText={() => {}} />
      {/* Header toolbar - right side */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="folder.badge.plus" onPress={() => {}} />
        <Stack.Toolbar.Button onPress={() => {}}>Edit</Stack.Toolbar.Button>
      </Stack.Toolbar>

      {/* Bottom toolbar */}
      <Stack.Toolbar placement="bottom">
        <Stack.Toolbar.SearchBarSlot />
        <Stack.Toolbar.Button
          icon="square.and.pencil"
          onPress={() => {}}
          separateBackground
        />
      </Stack.Toolbar>
    </>
  );
}
```

## Mail inbox example

```tsx
import { Color, Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

export default function InboxScreen() {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  return (
    <>
      <ScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: 16 }}
      >
        {/* Screen content */}
      </ScrollView>
      <Stack.Screen options={{ headerTransparent: true }} />
      <Stack.Screen.Title>Inbox</Stack.Screen.Title>
      <Stack.SearchBar placeholder="Search" onChangeText={() => {}} />
      {/* Header toolbar - right side */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button onPress={() => {}}>Select</Stack.Toolbar.Button>
        <Stack.Toolbar.Menu icon="ellipsis">
          <Stack.Toolbar.Menu inline>
            <Stack.Toolbar.Menu inline title="Sort By">
              <Stack.Toolbar.MenuAction isOn>
                Categories
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction>List</Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
            <Stack.Toolbar.MenuAction icon="info.circle">
              About categories
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction icon="person.circle">
            Show Contact Photos
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      {/* Bottom toolbar */}
      <Stack.Toolbar placement="bottom">
        <Stack.Toolbar.Button
          icon="line.3.horizontal.decrease"
          selected={isFilterOpen}
          onPress={() => setIsFilterOpen((prev) => !prev)}
        />
        <Stack.Toolbar.View hidden={!isFilterOpen}>
          <View style={{ width: 70, height: 32, justifyContent: "center" }}>
            <Text style={{ fontSize: 12, fontWeight: 700 }}>Filter by</Text>
            <Text
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: Color.ios.systemBlue,
              }}
            >
              Unread
            </Text>
          </View>
        </Stack.Toolbar.View>
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.SearchBarSlot />
        <Stack.Toolbar.Button
          icon="square.and.pencil"
          onPress={() => {}}
          separateBackground
        />
      </Stack.Toolbar>
    </>
  );
}
```

## Placement

- `"left"` - Header left
- `"right"` - Header right
- `"bottom"` (default) - Bottom toolbar

## Components

### Button

- Icon button: `<Stack.Toolbar.Button icon="star.fill" onPress={() => {}} />`
- Text button: `<Stack.Toolbar.Button onPress={() => {}}>Done</Stack.Toolbar.Button>`

**Props:** `icon`, `image`, `onPress`, `disabled`, `hidden`, `variant` (`"plain"` | `"done"` | `"prominent"`), `tintColor`

### Menu

Dropdown menu for grouping actions.

```tsx
<Stack.Toolbar.Menu icon="ellipsis">
  <Stack.Toolbar.Menu inline>
    <Stack.Toolbar.MenuAction>Sort by Recently Added</Stack.Toolbar.MenuAction>
    <Stack.Toolbar.MenuAction isOn>
      Sort by Date Captured
    </Stack.Toolbar.MenuAction>
  </Stack.Toolbar.Menu>
  <Stack.Toolbar.Menu title="Filter">
    <Stack.Toolbar.Menu inline>
      <Stack.Toolbar.MenuAction isOn icon="square.grid.2x2">
        All Items
      </Stack.Toolbar.MenuAction>
    </Stack.Toolbar.Menu>
    <Stack.Toolbar.MenuAction icon="heart">Favorites</Stack.Toolbar.MenuAction>
    <Stack.Toolbar.MenuAction icon="photo">Photos</Stack.Toolbar.MenuAction>
    <Stack.Toolbar.MenuAction icon="video">Videos</Stack.Toolbar.MenuAction>
  </Stack.Toolbar.Menu>
</Stack.Toolbar.Menu>
```

**Menu Props:** All Button props plus `title`, `inline`, `palette`, `elementSize` (`"small"` | `"medium"` | `"large"`)

**MenuAction Props:** `icon`, `onPress`, `isOn`, `destructive`, `disabled`, `subtitle`

When creating a palette with dividers, use `inline` combined with `elementSize="small"`. `palette` will not apply dividers on iOS 26.

### Spacer

```tsx
<Stack.Toolbar.Spacer />           // Bottom toolbar - flexible
<Stack.Toolbar.Spacer width={16} /> // Header - requires explicit width
```

### View

Embed custom React Native components. When adding a custom view make sure that there is only a single child with **explicit width and height**.

```tsx
<Stack.Toolbar.View>
  <View style={{ width: 70, height: 32, justifyContent: "center" }}>
    <Text style={{ fontSize: 12, fontWeight: 700 }}>Filter by</Text>
  </View>
</Stack.Toolbar.View>
```

You can pass custom components to views as well:

```tsx
function CustomFilterView() {
  return (
    <View style={{ width: 70, height: 32, justifyContent: "center" }}>
      <Text style={{ fontSize: 12, fontWeight: 700 }}>Filter by</Text>
    </View>
  );
}
...
<Stack.Toolbar.View>
  <CustomFilterView />
</Stack.Toolbar.View>
```

## Recommendations

- When creating more complex headers, extract them to a single component

```tsx
export default function Page() {
  return (
    <>
      <ScrollView>{/* Screen content */}</ScrollView>
      <InboxHeader />
    </>
  );
}

function InboxHeader() {
  return (
    <>
      <Stack.Screen.Title>Inbox</Stack.Screen.Title>
      <Stack.SearchBar placeholder="Search" onChangeText={() => {}} />
      <Stack.Toolbar placement="right">{/* Toolbar buttons */}</Stack.Toolbar>
    </>
  );
}
```

- When using `Stack.Toolbar`, make sure that all `Stack.Toolbar.*` components are wrapped inside `Stack.Toolbar` component.

This will **not work**:

```tsx
function Buttons() {
  return (
    <>
      <Stack.Toolbar.Button icon="star.fill" onPress={() => {}} />
      <Stack.Toolbar.Button onPress={() => {}}>Done</Stack.Toolbar.Button>
    </>
  );
}

function Page() {
  return (
    <>
      <ScrollView>{/* Screen content */}</ScrollView>
      <Stack.Toolbar placement="right">
        <Buttons /> {/* ❌ This will NOT work */}
      </Stack.Toolbar>
    </>
  );
}
```

This will work:

```tsx
function ToolbarWithButtons() {
  return (
    <Stack.Toolbar>
      <Stack.Toolbar.Button icon="star.fill" onPress={() => {}} />
      <Stack.Toolbar.Button onPress={() => {}}>Done</Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}

function Page() {
  return (
    <>
      <ScrollView>{/* Screen content */}</ScrollView>
      <ToolbarWithButtons /> {/* ✅ This will work */}
    </>
  );
}
```

## Limitations

- iOS only
- `placement="bottom"` can only be used inside screen components (not in layout files)
- `Stack.Toolbar.Badge` only works with `placement="left"` or `"right"`
- Header Spacers require explicit `width`

## Reference

Docs https://docs.expo.dev/versions/unversioned/sdk/router - read to see the full API.
