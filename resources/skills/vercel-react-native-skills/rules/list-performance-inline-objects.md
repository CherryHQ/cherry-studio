---
title: Avoid Inline Objects in renderItem
impact: HIGH
impactDescription: prevents unnecessary re-renders of memoized list items
tags: lists, performance, flatlist, virtualization, memo
---

## Avoid Inline Objects in renderItem

Don't create new objects inside `renderItem` to pass as props. Inline objects
create new references on every render, breaking memoization. Pass primitive
values directly from `item` instead.

**Incorrect (inline object breaks memoization):**

```tsx
function UserList({ users }: { users: User[] }) {
  return (
    <LegendList
      data={users}
      renderItem={({ item }) => (
        <UserRow
          // Bad: new object on every render
          user={{ id: item.id, name: item.name, avatar: item.avatar }}
        />
      )}
    />
  )
}
```

**Incorrect (inline style object):**

```tsx
renderItem={({ item }) => (
  <UserRow
    name={item.name}
    // Bad: new style object on every render
    style={{ backgroundColor: item.isActive ? 'green' : 'gray' }}
  />
)}
```

**Correct (pass item directly or primitives):**

```tsx
function UserList({ users }: { users: User[] }) {
  return (
    <LegendList
      data={users}
      renderItem={({ item }) => (
        // Good: pass the item directly
        <UserRow user={item} />
      )}
    />
  )
}
```

**Correct (pass primitives, derive inside child):**

```tsx
renderItem={({ item }) => (
  <UserRow
    id={item.id}
    name={item.name}
    isActive={item.isActive}
  />
)}

const UserRow = memo(function UserRow({ id, name, isActive }: Props) {
  // Good: derive style inside memoized component
  const backgroundColor = isActive ? 'green' : 'gray'
  return <View style={[styles.row, { backgroundColor }]}>{/* ... */}</View>
})
```

**Correct (hoist static styles in module scope):**

```tsx
const activeStyle = { backgroundColor: 'green' }
const inactiveStyle = { backgroundColor: 'gray' }

renderItem={({ item }) => (
  <UserRow
    name={item.name}
    // Good: stable references
    style={item.isActive ? activeStyle : inactiveStyle}
  />
)}
```

Passing primitives or stable references allows `memo()` to skip re-renders when
the actual values haven't changed.

**Note:** If you have the React Compiler enabled, it handles memoization
automatically and these manual optimizations become less critical.
