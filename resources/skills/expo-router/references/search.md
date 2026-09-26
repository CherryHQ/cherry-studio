# Search

## Header Search Bar

Add a search bar to the stack header with `headerSearchBarOptions`:

```tsx
<Stack.Screen
  name="index"
  options={{
    headerSearchBarOptions: {
      placeholder: "Search",
      onChangeText: (event) => console.log(event.nativeEvent.text),
    },
  }}
/>
```

### Options

```tsx
headerSearchBarOptions: {
  // Placeholder text
  placeholder: "Search items...",

  // Auto-capitalize behavior
  autoCapitalize: "none",

  // Input type
  inputType: "text", // "text" | "phone" | "number" | "email"

  // Cancel button text (iOS)
  cancelButtonText: "Cancel",

  // Hide when scrolling (iOS)
  hideWhenScrolling: true,

  // Hide navigation bar during search (iOS)
  hideNavigationBar: true,

  // Obscure background during search (iOS)
  obscureBackground: true,

  // Placement
  placement: "automatic", // "automatic" | "inline" | "stacked"

  // Callbacks
  onChangeText: (event) => {},
  onSearchButtonPress: (event) => {},
  onCancelButtonPress: (event) => {},
  onFocus: () => {},
  onBlur: () => {},
}
```

## useSearch Hook

Reusable hook for search state management:

```tsx
import { useEffect, useState } from "react";
import { useNavigation } from "expo-router";

export function useSearch(options: any = {}) {
  const [search, setSearch] = useState("");
  const navigation = useNavigation();

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerSearchBarOptions: {
        ...options,
        onChangeText(e: any) {
          setSearch(e.nativeEvent.text);
          options.onChangeText?.(e);
        },
        onSearchButtonPress(e: any) {
          setSearch(e.nativeEvent.text);
          options.onSearchButtonPress?.(e);
        },
        onCancelButtonPress(e: any) {
          setSearch("");
          options.onCancelButtonPress?.(e);
        },
      },
    });
  }, [options, navigation]);

  return search;
}
```

### Usage

```tsx
function SearchScreen() {
  const search = useSearch({ placeholder: "Search items..." });

  const filteredItems = items.filter(item =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <FlatList
      data={filteredItems}
      renderItem={({ item }) => <ItemRow item={item} />}
    />
  );
}
```

## Filtering Patterns

### Simple Text Filter

```tsx
const filtered = items.filter(item =>
  item.name.toLowerCase().includes(search.toLowerCase())
);
```

### Multiple Fields

```tsx
const filtered = items.filter(item => {
  const query = search.toLowerCase();
  return (
    item.name.toLowerCase().includes(query) ||
    item.description.toLowerCase().includes(query) ||
    item.tags.some(tag => tag.toLowerCase().includes(query))
  );
});
```

### Debounced Search

For expensive filtering or API calls:

```tsx
import { useState, useEffect, useMemo } from "react";

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

function SearchScreen() {
  const search = useSearch();
  const debouncedSearch = useDebounce(search, 300);

  const filteredItems = useMemo(() =>
    items.filter(item =>
      item.name.toLowerCase().includes(debouncedSearch.toLowerCase())
    ),
    [debouncedSearch]
  );

  return <FlatList data={filteredItems} />;
}
```

## Search with Native Tabs

When using NativeTabs with a search role, the search bar integrates with the tab bar:

```tsx
// app/_layout.tsx
<NativeTabs>
  <NativeTabs.Trigger name="(home)">
    <Label>Home</Label>
    <Icon sf="house.fill" />
  </NativeTabs.Trigger>
  <NativeTabs.Trigger name="(search)" role="search">
    <Label>Search</Label>
  </NativeTabs.Trigger>
</NativeTabs>
```

```tsx
// app/(search)/_layout.tsx
<Stack>
  <Stack.Screen
    name="index"
    options={{
      headerSearchBarOptions: {
        placeholder: "Search...",
        onChangeText: (e) => setSearch(e.nativeEvent.text),
      },
    }}
  />
</Stack>
```

## Empty States

Show appropriate UI when search returns no results:

```tsx
function SearchResults({ search, items }) {
  const filtered = items.filter(/* ... */);

  if (search && filtered.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Text style={{ color: colors.secondaryLabel }}>
          No results for "{search}"
        </Text>
      </View>
    );
  }

  return <FlatList data={filtered} />;
}
```

## Search Suggestions

Show recent searches or suggestions:

```tsx
function SearchScreen() {
  const search = useSearch();
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  if (!search && recentSearches.length > 0) {
    return (
      <View>
        <Text style={{ color: colors.secondaryLabel }}>
          Recent Searches
        </Text>
        {recentSearches.map((term) => (
          <Pressable key={term} onPress={() => /* apply search */}>
            <Text>{term}</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  return <SearchResults search={search} />;
}
```
