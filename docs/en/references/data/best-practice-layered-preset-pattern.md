# Layered Preset Configuration Pattern

The Layered Preset Configuration pattern is the recommended approach for handling scenarios where you have predefined configurations that users can partially customize.

## When to Use This Pattern

Use this pattern when:

- You have a list of predefined configurations (e.g., providers, templates, presets)
- Presets can be updated through app updates (add/remove/modify)
- Users can customize some fields of individual presets
- User customizations should persist while still receiving preset updates

## Architecture

```
┌─────────────────────────────┐
│     Runtime Config          │  ← Merged complete configuration
├─────────────────────────────┤
│   User Overrides Layer      │  ← User modifications (delta only)
├─────────────────────────────┤
│   Default Presets Layer     │  ← Predefined configurations
└─────────────────────────────┘
```

**Key benefits:**

- Presets can be updated independently
- User modifications are preserved
- Only differences are stored, minimizing storage
- Runtime merging provides the complete picture

## Storage Strategy

| Scenario                           | Recommended Storage  |
| ---------------------------------- | -------------------- |
| Large item count (dozens+) + critical data | Dedicated SQLite table |
| Small item count (< 20)            | Preference storage   |

For large-scale scenarios, the layered pattern still applies, but implementation details vary based on data characteristics. Refer to [DataApi documentation](./data-api-overview.md) for guidance.

**This document focuses on small-scale scenarios using Preference storage.**

## Preset File Standards

### Location

All preset configurations should be placed in:

```
packages/shared/data/presets/
```

### File Format

Use `.ts` files (not JSON):

- Small configurations typically don't need online update services
- TypeScript provides type safety
- Types and data can be co-located

### Naming Convention

| Element       | Convention                          | Example                      |
| ------------- | ----------------------------------- | ---------------------------- |
| File name     | kebab-case                          | `selection-actions.ts`       |
| Constant name | SCREAMING_SNAKE_CASE with `PRESETS_` prefix | `PRESETS_SELECTION_ACTIONS` |

**Naming correspondence:**

- `providers.ts` → `PRESETS_PROVIDERS`
- `selection-actions.ts` → `PRESETS_SELECTION_ACTIONS`
- `ai-models.ts` → `PRESETS_AI_MODELS`

### File Structure

A preset file should contain both type definitions and preset data:

> **Note:** The `Provider` example below is for illustration purposes only and does not represent the actual provider implementation in Cherry Studio. Your actual data structure will vary based on your specific requirements.

```typescript
// packages/shared/data/presets/providers.ts

// Type definitions
export interface Provider {
  id: string
  name: string
  apiHost: string
  models: string[]
}

// Preset data
export const PRESETS_PROVIDERS: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiHost: 'https://api.openai.com',
    models: ['gpt-4', 'gpt-3.5-turbo'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    apiHost: 'https://api.anthropic.com',
    models: ['claude-3-opus', 'claude-3-sonnet'],
  },
  // ...
]
```

## Implementation with Preference

### Step 1: Define Override Type

In your preset file, define the override type that represents user-customizable fields:

```typescript
// packages/shared/data/presets/providers.ts

// User-overridable fields (exclude id since it's the identifier)
export type ProviderOverride = Partial<Omit<Provider, 'id'>>

// Map of provider id to its overrides
export type ProviderOverrides = Record<string, ProviderOverride>
```

### Step 2: Register Preference Key

Add a preference key to store user overrides:

```typescript
// packages/shared/data/preference/preferenceSchemas.ts

export const DefaultPreferences = {
  default: {
    // ...existing preferences
    'providers.overrides': {} as ProviderOverrides,
  },
}
```

### Step 3: Create Merge Hook

Create a custom hook that merges presets with user overrides:

> **Note:** The hook below is a basic example. Your actual implementation should be tailored to your specific data structure and usage patterns. Consider factors like: which fields are user-editable, how merging should work for nested objects, whether you need filtering/sorting, etc.

```typescript
// src/renderer/src/hooks/useProviders.ts

import { useCallback, useMemo } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { PRESETS_PROVIDERS, ProviderOverride } from '@shared/data/presets/providers'

export function useProviders() {
  const [overrides, setOverrides] = usePreference('providers.overrides')

  // Merge: presets + user overrides
  const providers = useMemo(() => {
    return PRESETS_PROVIDERS.map((preset) => ({
      ...preset,
      ...overrides[preset.id],
    }))
  }, [overrides])

  // Update specific fields of a provider
  const updateProvider = useCallback(
    (id: string, updates: ProviderOverride) => {
      setOverrides({
        ...overrides,
        [id]: { ...overrides[id], ...updates },
      })
    },
    [overrides, setOverrides]
  )

  // Reset a provider to default values
  const resetProvider = useCallback(
    (id: string) => {
      const { [id]: _, ...rest } = overrides
      setOverrides(rest)
    },
    [overrides, setOverrides]
  )

  // Check if a provider has been customized
  const isCustomized = useCallback((id: string) => id in overrides, [overrides])

  return {
    providers,
    updateProvider,
    resetProvider,
    isCustomized,
  }
}
```

### Usage Example

```typescript
function ProviderSettings() {
  const { providers, updateProvider, resetProvider, isCustomized } = useProviders()

  return (
    <>
      {providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          isCustomized={isCustomized(provider.id)}
          onApiHostChange={(host) => updateProvider(provider.id, { apiHost: host })}
          onReset={() => resetProvider(provider.id)}
        />
      ))}
    </>
  )
}
```

## Pure Presets (No User Override)

For presets that don't require user customization, simply place them in the presets directory and import directly:

```typescript
// packages/shared/data/presets/languages.ts

export interface Language {
  code: string
  name: string
  nativeName: string
}

export const PRESETS_LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  // ...
]
```

Usage:

```typescript
import { PRESETS_LANGUAGES } from '@shared/data/presets/languages'

function LanguageSelector() {
  return (
    <select>
      {PRESETS_LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.nativeName}
        </option>
      ))}
    </select>
  )
}
```

## Update Compatibility

The layered pattern ensures smooth updates:

| Operation           | Behavior                                              |
| ------------------- | ----------------------------------------------------- |
| Add new preset      | Automatically appears in the list (no override)       |
| Remove preset       | Disappears from list; override data retained (harmless) |
| Modify preset field | User-overridden fields keep user values; others update |

**Example scenario:**

1. App ships with `PRESETS_PROVIDERS` containing OpenAI with `apiHost: 'https://api.openai.com'`
2. User changes OpenAI's `apiHost` to `'https://my-proxy.com'`
3. App update changes OpenAI's `models` array
4. Result: User keeps their custom `apiHost`, but gets the new `models`

## Versioning for Complex Presets

For presets with frequent configuration changes, consider adding a version field to facilitate migration management:

```typescript
// packages/shared/data/presets/complex-config.ts

export const PRESETS_COMPLEX_CONFIG_VERSION = 2

export interface ComplexConfig {
  id: string
  // ... other fields
}

export const PRESETS_COMPLEX_CONFIG: ComplexConfig[] = [
  // ...
]
```

Store the version alongside user overrides in a single object:

```typescript
// preferenceSchemas.ts
'complex_config.overrides': {
  version: 0,
  data: {}
} as { version: number; data: ComplexConfigOverrides },
```

When the preset version changes, implement migration logic to transform the stored overrides to the new format.

This approach is recommended when:

- Configuration structure changes frequently
- Field names or types may be renamed/changed
- You need to clean up deprecated override data

## Related Documentation

- [Preference Usage Guide](./preference-usage.md) - How to use usePreference hook
- [Preference Schema Guide](./preference-schema-guide.md) - Adding new preference keys
- [Data System Overview](./README.md) - Choosing the right data system
