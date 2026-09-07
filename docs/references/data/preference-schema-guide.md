---
description: How to add Preference keys through the data-classify generator without editing generated schemas
sources:
  - v2-refactor-temp/tools/data-classify/data/classification.json
  - v2-refactor-temp/tools/data-classify/data/target-key-definitions.json
  - v2-refactor-temp/tools/data-classify/scripts/generate-preferences.js
  - src/shared/data/preference/preferenceTypes.ts
---

# Preference Schema Guide

`src/shared/data/preference/preferenceSchemas.ts` is generated. Never edit its
`PreferenceSchemas` interface or `DefaultPreferences` object by hand. Change the
generator inputs, run the generator, and commit the generated result.

## Choose the Source File

| Kind of key | Source of truth |
|---|---|
| New v2 setting with no v1 source | `v2-refactor-temp/tools/data-classify/data/target-key-definitions.json` |
| Simple v1-to-v2 mapping | `v2-refactor-temp/tools/data-classify/data/classification.json` |
| Complex migration output | `target-key-definitions.json`, plus the transformer and complex mapping owned by the v2 migrator |
| Reusable TypeScript type | `src/shared/data/preference/preferenceTypes.ts` |

`target-key-definitions.json` entries with `status: "classified"` are emitted.
Entries with `status: "pending"` are not part of the generated Preference schema.

## Key Naming

Preference keys use at least two dot-separated lowercase segments. Multi-word
segments use underscores:

```text
namespace.category.key_name
```

The `data-schema-key/valid-key` lint rule enforces
`/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/`.

Prefer an existing domain namespace. A new namespace should represent a real
cross-application domain, not one call site.

```text
app.spell_check.enabled
chat.message.font_size
feature.quick_assistant.enabled
shortcut.general.show_main_window
```

## Value Shape

- Keep independent settings in independent keys.
- Store one object only when callers read and write it as one logical value.
- Every emitted key has a default. The generator writes that default into
  `DefaultPreferences` and the Preference seeder materializes missing rows.
- Put shared unions, enums, branded types, and object contracts in
  `preferenceTypes.ts`; reference them as `PreferenceTypes.X` in the generator
  input.

Example new key:

```json
{
  "targetKey": "feature.my_feature.enabled",
  "type": "boolean",
  "defaultValue": false,
  "status": "classified",
  "description": "Enable My Feature"
}
```

For a TypeScript expression rather than a JSON literal, use the generator's
`VALUE:` form:

```json
{
  "targetKey": "feature.my_feature.mode",
  "type": "PreferenceTypes.MyFeatureMode",
  "defaultValue": "VALUE: PreferenceTypes.MyFeatureMode.Auto",
  "status": "classified",
  "description": "My Feature mode"
}
```

## Generate and Use

Run the supported generator pipeline from its package directory:

```bash
cd v2-refactor-temp/tools/data-classify
npm run generate
```

This regenerates all four coupled outputs:

- `src/shared/data/preference/preferenceSchemas.ts`
- `src/shared/data/bootConfig/bootConfigSchemas.ts`
- `src/main/data/migration/v2/migrators/mappings/PreferencesMappings.ts`
- `src/main/data/migration/v2/migrators/mappings/BootConfigMappings.ts`

Then consume the generated key through the normal Preference API:

```typescript
import { usePreference } from '@data/hooks/usePreference'

const [enabled, setEnabled] = usePreference('feature.my_feature.enabled')
```

Run `pnpm lint` after changing a key. It checks generated types, key naming,
formatting, and all Preference call sites.

## Migration-only Additions

For a simple migrated value, update the corresponding classified entry in
`classification.json` with its legacy source and target key. For a value that
combines or transforms multiple legacy inputs:

1. Define the emitted target key in `target-key-definitions.json`.
2. Add the conversion to
   `src/main/data/migration/v2/migrators/transformers/PreferenceTransformers.ts`.
3. Register it in
   `src/main/data/migration/v2/migrators/mappings/ComplexPreferenceMappings.ts`.
4. Run `npm run generate`.

Do not add a v1 read fallback or a second runtime source of truth. Legacy data
reaches the current Preference table only through the v2 migrator.

## Related Documentation

- [Preference Overview](./preference-overview.md)
- [Preference Usage](./preference-usage.md)
- [Migration V2](./v2-migration-guide.md)
