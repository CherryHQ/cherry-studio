# Redux Serialization Fix: Tab Icons

## Problem

The application was storing React elements (JSX) in Redux state, which violates Redux's core principle that state must be serializable. Specifically:

1. The `Tab` interface in `store/tabs.ts` allowed `icon?: string | React.ReactNode`
2. Components were passing React elements when opening tabs
3. This caused Redux serialization warnings about non-serializable values

## Solution

### 1. Updated Tab Interface
Changed the Tab interface to only accept serializable icon data:

```typescript
export interface Tab {
  // ...
  icon?: string // Only allow serializable string icons (e.g., emojis or icon names)
  // ...
}
```

### 2. Updated Component Logic
- Removed React element icons from being passed to Redux when opening tabs
- Tab components now generate icons dynamically based on routes
- String icons (like emojis) are still supported and stored in Redux

### 3. Icon Rendering Strategy
All tab components (TabItem, AnimatedTabItem, DraggableTabItem) now:
1. Check if `tab.icon` is a string (emoji) and render it
2. Otherwise, use an internal `iconMap` to generate icons based on routes
3. Never rely on React elements from Redux state

## Example

Before (problematic):
```typescript
dispatch(openTab({
  // ...
  icon: <MessageSquare size={18} />, // ❌ React element in Redux
}))
```

After (fixed):
```typescript
dispatch(openTab({
  // ...
  icon: "📝", // ✅ Serializable string (optional)
  // or don't pass icon at all - let component decide based on route
}))
```

## Benefits
- Redux state is now fully serializable
- No more console warnings about non-serializable values
- Better Redux DevTools compatibility
- Follows Redux best practices