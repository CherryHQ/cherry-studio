---
title: Use contentInset for Dynamic ScrollView Spacing
impact: LOW
impactDescription: smoother updates, no layout recalculation
tags: scrollview, layout, contentInset, performance
---

## Use contentInset for Dynamic ScrollView Spacing

When adding space to the top or bottom of a ScrollView that may change
(keyboard, toolbars, dynamic content), use `contentInset` instead of padding.
Changing `contentInset` doesn't trigger layout recalculation—it adjusts the
scroll area without re-rendering content.

**Incorrect (padding causes layout recalculation):**

```tsx
function Feed({ bottomOffset }: { bottomOffset: number }) {
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: bottomOffset }}>
      {children}
    </ScrollView>
  )
}
// Changing bottomOffset triggers full layout recalculation
```

**Correct (contentInset for dynamic spacing):**

```tsx
function Feed({ bottomOffset }: { bottomOffset: number }) {
  return (
    <ScrollView
      contentInset={{ bottom: bottomOffset }}
      scrollIndicatorInsets={{ bottom: bottomOffset }}
    >
      {children}
    </ScrollView>
  )
}
// Changing bottomOffset only adjusts scroll bounds
```

Use `scrollIndicatorInsets` alongside `contentInset` to keep the scroll
indicator aligned. For static spacing that never changes, padding is fine.
