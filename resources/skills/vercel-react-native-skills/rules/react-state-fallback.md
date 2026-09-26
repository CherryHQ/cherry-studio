---
title: Use fallback state instead of initialState
impact: MEDIUM
impactDescription: reactive fallbacks without syncing
tags: state, hooks, derived-state, props, initialState
---

## Use fallback state instead of initialState

Use `undefined` as initial state and nullish coalescing (`??`) to fall back to
parent or server values. State represents user intent only—`undefined` means
"user hasn't chosen yet." This enables reactive fallbacks that update when the
source changes, not just on initial render.

**Incorrect (syncs state, loses reactivity):**

```tsx
type Props = { fallbackEnabled: boolean }

function Toggle({ fallbackEnabled }: Props) {
  const [enabled, setEnabled] = useState(defaultEnabled)
  // If fallbackEnabled changes, state is stale
  // State mixes user intent with default value

  return <Switch value={enabled} onValueChange={setEnabled} />
}
```

**Correct (state is user intent, reactive fallback):**

```tsx
type Props = { fallbackEnabled: boolean }

function Toggle({ fallbackEnabled }: Props) {
  const [_enabled, setEnabled] = useState<boolean | undefined>(undefined)
  const enabled = _enabled ?? defaultEnabled
  // undefined = user hasn't touched it, falls back to prop
  // If defaultEnabled changes, component reflects it
  // Once user interacts, their choice persists

  return <Switch value={enabled} onValueChange={setEnabled} />
}
```

**With server data:**

```tsx
function ProfileForm({ data }: { data: User }) {
  const [_theme, setTheme] = useState<string | undefined>(undefined)
  const theme = _theme ?? data.theme
  // Shows server value until user overrides
  // Server refetch updates the fallback automatically

  return <ThemePicker value={theme} onChange={setTheme} />
}
```
