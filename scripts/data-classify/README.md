# Data schema and migration generators

This tool owns the source definitions for Preference and BootConfig schemas and the supported v1-to-v2 migration mappings. It uses Node.js built-ins and needs no separate dependency install.

## Sources

- `data/classification.json`: legacy keys classified by target data system, including simple Preference and BootConfig definitions.
- `data/target-key-definitions.json`: complex mappings and new product Preference keys without a v1 source.
- `scripts/generate-boot-config.js`: additional BootConfig definitions in `MANUAL_BOOT_CONFIG_ITEMS`.

## Generate

From the repository root:

```sh
pnpm data:generate
```

To run an individual generator, use `npm run generate:preferences`, `generate:boot-config`, or `generate:migration` in this directory.

The pipeline writes these four files; edit the sources above rather than these outputs:

- `src/shared/data/preference/preferenceSchemas.ts`
- `src/shared/data/bootConfig/bootConfigSchemas.ts`
- `src/main/data/migration/v2/migrators/mappings/PreferencesMappings.ts`
- `src/main/data/migration/v2/migrators/mappings/BootConfigMappings.ts`

After generation, inspect the diff. A relocation must preserve keys, types, defaults, and migration mappings. Run `pnpm lint` and the tests covering any intended schema or migration behavior change.

The retired inventory extraction and validation scripts are no longer part of this tool. Separating permanent product definitions from migration inputs remains tracked in [#19192](https://github.com/CherryHQ/cherry-studio/issues/19192).
