---
title: Optimize List Performance with Stable Object References
impact: CRITICAL
impactDescription: virtualization relies on reference stability
tags: lists, performance, flatlist, virtualization
---

## Optimize List Performance with Stable Object References

Don't map or filter data before passing to virtualized lists. Virtualization
relies on object reference stability to know what changed—new references cause
full re-renders of all visible items. Attempt to prevent frequent renders at the
list-parent level.

Where needed, use context selectors within list items.

**Incorrect (creates new object references on every keystroke):**

```tsx
function DomainSearch() {
  const { keyword, setKeyword } = useKeywordZustandState()
  const { data: tlds } = useTlds()

  // Bad: creates new objects on every render, reparenting the entire list on every keystroke
  const domains = tlds.map((tld) => ({
    domain: `${keyword}.${tld.name}`,
    tld: tld.name,
    price: tld.price,
  }))

  return (
    <>
      <TextInput value={keyword} onChangeText={setKeyword} />
      <LegendList
        data={domains}
        renderItem={({ item }) => <DomainItem item={item} keyword={keyword} />}
      />
    </>
  )
}
```

**Correct (stable references, transform inside items):**

```tsx
const renderItem = ({ item }) => <DomainItem tld={item} />

function DomainSearch() {
  const { data: tlds } = useTlds()

  return (
    <LegendList
      // good: as long as the data is stable, LegendList will not re-render the entire list
      data={tlds}
      renderItem={renderItem}
    />
  )
}

function DomainItem({ tld }: { tld: Tld }) {
  // good: transform within items, and don't pass the dynamic data as a prop
  // good: use a selector function from zustand to receive a stable string back
  const domain = useKeywordZustandState((s) => s.keyword + '.' + tld.name)
  return <Text>{domain}</Text>
}
```

**Updating parent array reference:**

Creating a new array instance can be okay, as long as its inner object
references are stable. For instance, if you sort a list of objects:

```tsx
// good: creates a new array instance without mutating the inner objects
// good: parent array reference is unaffected by typing and updating "keyword"
const sortedTlds = tlds.toSorted((a, b) => a.name.localeCompare(b.name))

return <LegendList data={sortedTlds} renderItem={renderItem} />
```

Even though this creates a new array instance `sortedTlds`, the inner object
references are stable.

**With zustand for dynamic data (avoids parent re-renders):**

```tsx
const useSearchStore = create<{ keyword: string }>(() => ({ keyword: '' }))

function DomainSearch() {
  const { data: tlds } = useTlds()

  return (
    <>
      <SearchInput />
      <LegendList
        data={tlds}
        // if you aren't using React Compiler, wrap renderItem with useCallback
        renderItem={({ item }) => <DomainItem tld={item} />}
      />
    </>
  )
}

function DomainItem({ tld }: { tld: Tld }) {
  // Select only what you need—component only re-renders when keyword changes
  const keyword = useSearchStore((s) => s.keyword)
  const domain = `${keyword}.${tld.name}`
  return <Text>{domain}</Text>
}
```

Virtualization can now skip items that haven't changed when typing. Only visible
items (~20) re-render on keystroke, rather than the parent.

**Deriving state within list items based on parent data (avoids parent
re-renders):**

For components where the data is conditional based on the parent state, this
pattern is even more important. For example, if you are checking if an item is
favorited, toggling favorites only re-renders one component if the item itself
is in charge of accessing the state rather than the parent:

```tsx
function DomainItemFavoriteButton({ tld }: { tld: Tld }) {
  const isFavorited = useFavoritesStore((s) => s.favorites.has(tld.id))
  return <TldFavoriteButton isFavorited={isFavorited} />
}
```

Note: if you're using the React Compiler, you can read React Context values
directly within list items. Although this is slightly slower than using a
Zustand selector in most cases, the effect may be negligible.
