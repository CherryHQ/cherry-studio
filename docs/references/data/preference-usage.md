---
description: Current usePreference, useMultiplePreferences, and direct PreferenceService APIs
sources:
  - src/renderer/data/hooks/usePreference.ts
  - src/renderer/data/PreferenceService.ts
  - src/main/data/PreferenceService.ts
---

# Preference Usage Guide

## React Hooks

Use `usePreference` for one key. The value has its generated default applied and
the setter returns a Promise.

```typescript
import { usePreference } from '@data/hooks/usePreference'

const [theme, setTheme] = usePreference('ui.theme_mode')
await setTheme('dark')
```

Updates are optimistic by default. Request pessimistic behavior when the UI
must wait for persistence confirmation:

```typescript
const [developerMode, setDeveloperMode] = usePreference('app.developer_mode.enabled', {
  optimistic: false
})
await setDeveloperMode(true)
```

Use `useMultiplePreferences` for a related set. It accepts an object that maps
local names to generated keys and returns `[values, updateValues]`:

```typescript
import { useMultiplePreferences } from '@data/hooks/usePreference'

const [settings, updateSettings] = useMultiplePreferences({
  theme: 'ui.theme_mode',
  language: 'app.language',
  fontSize: 'chat.message.font_size'
})

await updateSettings({ theme: 'system', language: 'en-US' })
```

Keep the key-map object referentially stable (module constant or `useMemo`) when
it is constructed from dynamic input; it is a hook dependency and subscription
definition.

## Renderer Service

Non-React renderer code can use the singleton directly:

```typescript
import { preferenceService } from '@data/PreferenceService'

const theme = await preferenceService.get('ui.theme_mode')
const settings = await preferenceService.getMultiple({
  language: 'app.language',
  fontSize: 'chat.message.font_size'
})

await preferenceService.set('ui.theme_mode', 'dark')
await preferenceService.setMultiple({
  'app.language': 'en-US',
  'chat.message.font_size': 16
})
```

`getMultiple()` takes a local-name-to-key object. Use `getMultipleRaw(keys)` only
when the returned object must be keyed by the Preference keys themselves.

Renderer `subscribeChange(key)` is curried:

```typescript
const unsubscribe = preferenceService.subscribeChange('ui.theme_mode')(() => {
  const theme = preferenceService.getCachedValue('ui.theme_mode')
  logger.info('Theme changed', { theme })
})
```

Always call the returned unsubscribe when the owner is disposed. React code
should use the hooks, which manage this lifecycle automatically.

## Main Service

Main code accesses the lifecycle-managed service through `application`:

```typescript
import { application } from '@application'

const preferences = application.get('PreferenceService')
const theme = preferences.get('ui.theme_mode')
const { language, fontSize } = preferences.getMultiple({
  language: 'app.language',
  fontSize: 'chat.message.font_size'
})

await preferences.set('ui.theme_mode', 'dark')
```

Main `get()`/`getMultiple()` are synchronous cached reads. Writes return a
Promise because the service publishes cross-window notifications after the
synchronous storage operation.

Main subscriptions use `subscribeChange(key, callback)`. A lifecycle service
must register the returned disposable:

```typescript
this.registerDisposable(
  preferences.subscribeChange('ui.theme_mode', (theme) => {
    logger.info('Theme changed', { theme })
  })
)
```

## Failure Semantics

- Optimistic renderer writes update immediately and roll back if Main rejects
  the write.
- Pessimistic writes leave the old cache value visible until Main confirms.
- Batch optimistic rollback restores the original value for every affected key.
- Hook setters rethrow failures; the caller decides how to notify the user.

## Adding a Key

Add generator input and regenerate; never edit `preferenceSchemas.ts` or
`DefaultPreferences` directly. See
[Preference Schema Guide](./preference-schema-guide.md).

## Related Documentation

- [Preference Overview](./preference-overview.md)
- [Data System Reference](./README.md)
