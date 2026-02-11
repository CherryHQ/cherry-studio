# Preference Schema Guide

This guide explains how to add new preference keys to Cherry Studio.

## Key Naming Conventions

### Format

All preference keys MUST follow the format: `namespace.sub.key_name`

**Rules:**

- At least 2 segments separated by dots (.)
- Each segment uses lowercase letters, numbers, and underscores only
- Pattern: `/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/`

### Naming Principles

1. **Semantic Grouping**: Group related settings under common namespaces

   - `app.*` - Application-level settings
   - `chat.*` - Chat/message settings
   - `feature.*` - Feature toggles
   - `ui.*` - UI/theme settings
   - `data.*` - Data/backup settings
   - `shortcut.*` - Keyboard shortcuts

   **Namespace principles:**

   - Namespaces represent major features with **global impact** across the application
   - The existing namespaces should already cover most use cases
   - If you believe a new namespace is needed, think from a **global perspective** - it should represent a fundamental category, not just a single feature

2. **Hierarchy**: Use dots for hierarchy, underscores for multi-word names

   - `chat.message.font_size` (not `chat.messageFontSize`)
   - `feature.quick_assistant.enabled` (not `feature.quickAssistant.enabled`)

3. **Boolean Naming**: Use positive names with `.enabled` suffix for toggles
   - `feature.memory.enabled` (not `feature.memory.disabled`)
   - `app.spell_check.enabled`

### Examples

| Valid                     | Invalid                | Reason                 |
| ------------------------- | ---------------------- | ---------------------- |
| `app.user.avatar`         | `userAvatar`           | Missing dot separator  |
| `chat.multi_select_mode`  | `chat.multiSelectMode` | camelCase not allowed  |
| `feature.memory.enabled`  | `Feature.memory`       | Uppercase not allowed  |

## Design Principles

### Prefer Flat Over Nested

Prefer granular, flat preference keys over storing complex objects.

**Why:**

1. **Visibility**: Individual config items are more explicit and discoverable
2. **Performance**: Avoids parsing entire objects when reading/writing common items

**When to use flat keys:**

```typescript
// Good: Flat keys for independent settings
'chat.code.collapsible': boolean
'chat.code.show_line_numbers': boolean
'chat.code.wrappable': boolean
```

**When to keep as object:**

Only use object values when the data is frequently read/written as a whole unit.

```typescript
// Acceptable: Shortcut config is always read/written together
'shortcut.app.show_main_window': { key: string[], enabled: boolean, ... }
```

**Rule of thumb:** If you find yourself frequently accessing just one property of an object, split it into separate keys.

### Keep Values Atomic

Each preference should represent one logical setting. Don't combine unrelated settings.

```typescript
// Good: One setting per key
'chat.message.font_size': number
'chat.message.font_family': string

// Bad: Multiple settings in one key
'chat.message.font': { size: number, family: string }
```

### Provide Sensible Defaults

All preferences MUST have default values in `DefaultPreferences`.

## Adding a New Preference

### Step 1: Define Custom Types (if needed)

If your preference uses a custom type (enum, union type, etc.), add it first.

**File:** `packages/shared/data/preference/preferenceTypes.ts`

```typescript
// Example: Adding a new enum type
export enum MyFeatureMode {
  auto = 'auto',
  manual = 'manual',
  disabled = 'disabled'
}
```

### Step 2: Add to Schema Interface

**File:** `packages/shared/data/preference/preferenceSchemas.ts`

Add your key to the `PreferenceSchemas` interface:

```typescript
export interface PreferenceSchemas {
  default: {
    // ...existing keys (alphabetically sorted)...
    'feature.my_feature.enabled': boolean
    'feature.my_feature.mode': PreferenceTypes.MyFeatureMode
  }
}
```

### Step 3: Add Default Value

In the same file, add default value to `DefaultPreferences`:

```typescript
export const DefaultPreferences: PreferenceSchemas = {
  default: {
    // ...existing defaults (alphabetically sorted)...
    'feature.my_feature.enabled': true,
    'feature.my_feature.mode': PreferenceTypes.MyFeatureMode.auto,
  }
}
```

### Step 4: Use in Code

```typescript
import { usePreference } from '@data/hooks/usePreference'

const [enabled, setEnabled] = usePreference('feature.my_feature.enabled')
const [mode, setMode] = usePreference('feature.my_feature.mode')
```

## File Structure

| File                                                  | Purpose                                     |
| ----------------------------------------------------- | ------------------------------------------- |
| `packages/shared/data/preference/preferenceSchemas.ts`| Schema interface and default values         |
| `packages/shared/data/preference/preferenceTypes.ts`  | Custom type definitions (enums, unions)     |

## Best Practices Summary

1. **Flat over nested**: Split objects into individual keys unless frequently accessed as a whole
2. **Atomic values**: One preference = one logical setting
3. **Sensible defaults**: All preferences must have default values
4. **Consistent naming**: Follow `namespace.category.key_name` pattern
5. **2-3 levels**: Don't over-nest; 2-3 dot-separated segments is usually sufficient

## Related Documentation

- [Preference Overview](./preference-overview.md) - Architecture and sync mechanism
- [Preference Usage](./preference-usage.md) - Hooks and service API
