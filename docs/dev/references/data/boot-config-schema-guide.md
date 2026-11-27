---
description: How to add boot config keys to the auto-generated schema, plus the V1-to-V2 boot config migration pipeline
sources:
  - src/shared/data/bootConfig/bootConfigSchemas.ts
  - src/shared/data/bootConfig/bootConfigTypes.ts
  - src/main/data/bootConfig
  - scripts/data-classify/scripts/generate-boot-config.js
  - scripts/data-classify/data/classification.json
---

# Boot Config Schema Guide

This guide explains how to add new boot config keys and covers the V1-to-V2 data migration pipeline.

## When to Use BootConfig

BootConfig is for a **very narrow** set of configuration items. Before adding a key here, ask:

| Question | If Yes | If No |
|----------|--------|-------|
| Must it load before the lifecycle system takes over? | BootConfig | Preference |
| Does it affect process-level behavior (Chromium flags, data directory)? | BootConfig | Preference |
| Can it wait for the `BeforeReady` lifecycle phase? | Preference | BootConfig |
| Can it be changed at runtime without restart? | Preference | BootConfig |

**Rule of thumb:** If the setting can wait until the lifecycle's `BeforeReady` phase, it belongs in Preference. BootConfig is only for settings that must be available before the lifecycle system even starts. Keep it minimal.

## Key Naming Conventions

Boot config keys follow the same naming convention as preferences.

### Format

`namespace.key_name` — at least 2 segments separated by dots.

**Rules:**

- Lowercase letters, numbers, and underscores only
- Pattern: `/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/`
- Use dots for hierarchy, underscores for multi-word names

### Examples

| Valid | Invalid | Reason |
|-------|---------|--------|
| `app.disable_hardware_acceleration` | `disableHardwareAcceleration` | Missing dot separator |
| `app.user_data_path` | `App.userDataPath` | Uppercase, camelCase |
| `chromium.gpu_compositing` | `gpu` | Single segment |

## Adding a New Boot Config Key

### Step 1: Add to the Generator Input

**File:** `src/shared/data/bootConfig/bootConfigSchemas.ts` (auto-generated — do not edit by hand)

The zod schema is the single source of truth: the `BootConfigSchema` type is inferred from it, and `BootConfigService` validates file/set values against it at runtime. The current shape:

```typescript
export const bootConfigSchema = z.object({
  'app.disable_hardware_acceleration': z.boolean(),
  'app.user_data_path': z.record(z.string(), z.string())
})

export type BootConfigSchema = z.infer<typeof bootConfigSchema>

export const DefaultBootConfig: BootConfigSchema = {
  'app.disable_hardware_acceleration': false,
  'app.user_data_path': {}
}
```

> **This file is fully auto-generated.** For a key migrated from a supported v1
> source, edit `classification.json`. For a new key without a legacy source, or
> a config-file-sourced key, add it to `MANUAL_BOOT_CONFIG_ITEMS` in
> `generate-boot-config.js`. Complex types need an explicit `zodType`
> expression. Then regenerate as described below.

### Step 2: Add Custom Types (if needed)

**File:** `src/shared/data/bootConfig/bootConfigTypes.ts`

For simple types (boolean, string, number), no changes needed — the type is inferred from the schema. For custom types, define them alongside `BootConfigKey`:

```typescript
export type BootConfigKey = keyof BootConfigSchema

// Custom types if needed
export type GpuMode = 'auto' | 'disabled' | 'software'
```

### Step 3: Use in Early Boot Code (if needed)

Only for settings that must take effect before lifecycle:

**File:** `src/main/main.ts`

```typescript
import { bootConfigService } from '@main/data/bootConfig'

// Apply before app.whenReady()
if (bootConfigService.get('app.disable_hardware_acceleration')) {
  app.disableHardwareAcceleration()
}
```

### Step 4: Access from Renderer / Lifecycle Services

No additional wiring needed. The `BootConfigPreferenceKeys` mapped type automatically adds the `BootConfig.` prefix, making the key available through the unified preference API:

```typescript
// Renderer — works immediately after adding to schema
const [disableHardwareAcceleration, setDisableHardwareAcceleration] = usePreference(
  'BootConfig.app.disable_hardware_acceleration'
)

// Main process lifecycle service
const disableHardwareAcceleration = preferenceService.get('BootConfig.app.disable_hardware_acceleration')
```

> **Internal `temp.*` keys are the exception.** Keys under the `temp.*` prefix are main-process-internal transient state and are **deliberately excluded** from the unified preference API — not in `UnifiedPreferenceType`, not reachable via `usePreference`, and rejected at the PreferenceService IPC boundary. Access them only via `bootConfigService` directly (at any phase), and use `bootConfigService.onChange()` for notification. See [Internal `temp.*` namespace](./boot-config-overview.md#internal-temp-namespace).

For detailed usage of `usePreference`, see [Preference Usage Guide](./preference-usage.md).

## Legacy Data

V1 conversion runs only in the fixed intermediate release described in the [upgrade guide](./v2-migration-guide.md). The generator still produces BootConfig schemas from `classification.json` and `MANUAL_BOOT_CONFIG_ITEMS`; it no longer emits conversion mappings.

## Best Practices

1. **Keep BootConfig minimal** — most settings belong in Preference. Only use BootConfig for settings that must load before the lifecycle system takes over.
2. **Provide sensible defaults** — BootConfigService uses defaults on first launch (missing file). A missing default means the key is unusable on first launch.
3. **Follow naming conventions** — use the same `namespace.key_name` pattern as preferences for consistency.
4. **Process-level settings require restart** — document this in the UI when exposing boot config settings to users.

## Related Documentation

- [Boot Config Overview](./boot-config-overview.md) - Architecture and timing
- [Preference Schema Guide](./preference-schema-guide.md) - Adding preference keys (non-boot)
- [Preference Usage Guide](./preference-usage.md) - `usePreference` hook and service API
- [V2 Migration Guide](./v2-migration-guide.md) - Full migration system documentation
