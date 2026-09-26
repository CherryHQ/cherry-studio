---
title: Hoist Intl Formatter Creation
impact: LOW-MEDIUM
impactDescription: avoids expensive object recreation
tags: javascript, intl, optimization, memoization
---

## Hoist Intl Formatter Creation

Don't create `Intl.DateTimeFormat`, `Intl.NumberFormat`, or
`Intl.RelativeTimeFormat` inside render or loops. These are expensive to
instantiate. Hoist to module scope when the locale/options are static.

**Incorrect (new formatter every render):**

```tsx
function Price({ amount }: { amount: number }) {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  })
  return <Text>{formatter.format(amount)}</Text>
}
```

**Correct (hoisted to module scope):**

```tsx
const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

function Price({ amount }: { amount: number }) {
  return <Text>{currencyFormatter.format(amount)}</Text>
}
```

**For dynamic locales, memoize:**

```tsx
const dateFormatter = useMemo(
  () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
  [locale]
)
```

**Common formatters to hoist:**

```tsx
// Module-level formatters
const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })
const timeFormatter = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' })
const percentFormatter = new Intl.NumberFormat('en-US', { style: 'percent' })
const relativeFormatter = new Intl.RelativeTimeFormat('en-US', {
  numeric: 'auto',
})
```

Creating `Intl` objects is significantly more expensive than `RegExp` or plain
objects—each instantiation parses locale data and builds internal lookup tables.
