# BootConfigMigrator

The `BootConfigMigrator` migrates early-boot configuration from legacy storage into `bootConfigService` — the synchronous, file-based config used by code that runs before the lifecycle system takes over (e.g. Chromium flags, custom userData directory).

Unlike other migrators, it writes to a **file-based store** (`~/.cherrystudio/boot-config.json`) rather than a SQLite table. See [Boot Config Overview](../../../../../../docs/references/data/boot-config-overview.md) for why this system exists.

## Data Sources

Boot config pulls from **five** source kinds. Four are classification-driven (via `data-classify` + `BOOT_CONFIG_*_MAPPINGS` in `mappings/BootConfigMappings.ts`); one is manually maintained inline for a data shape the toolchain doesn't yet model.

| Source kind | Reader | Origin | Currently migrates |
|------|--------|-----------|-----|
| `redux` | `ReduxStateReader` | Redux Persist `reduxData` JSON | `settings.disableHardwareAcceleration` → `app.disable_hardware_acceleration` |
| `electronStore` | `ctx.sources.electronStore` (electron-store) | `{userData}/config.json` | (none currently — classification empty) |
| `dexie-settings` | `DexieSettingsReader` | Dexie `settings` table export | (none currently — classification empty) |
| `localStorage` | `LocalStorageReader` | localStorage export JSON | (none currently — classification empty) |
| `configfile` | `LegacyHomeConfigReader` | `~/.cherrystudio/config/config.json` (v1 home config file) | `appDataPath` → `app.user_data_path` |

### The `configfile` source

The `configfile` source exists because v1 stored the user-customized userData directory in `~/.cherrystudio/config/config.json` rather than in any of the four classification-driven stores. That file is outside the app's `userData` directory (intentionally — it needs to be readable before the userData path is decided), so none of the other readers can reach it.

`LegacyHomeConfigReader` reads the v1 file and normalizes two historical data shapes:

- Legacy string: `{ "appDataPath": "/path" }` → wrapped into a single-entry record keyed by `app.getPath('exe')`
- Array (current v1): `{ "appDataPath": [{ executablePath, dataPath }, ...] }` → converted to `Record<executablePath, dataPath>`; entries missing either field are filtered out

Returns `null` (not `{}`) when no data is present (missing file / parse error / empty array / all entries invalid). This `null` flows into the shared null-skip guard in `prepare()`, matching the other sources' "no data → skip" semantics.

## Field Mappings

### Redux → BootConfig

| Source (category / key) | Target Key | Type | Default |
|---|---|---|---|
| `settings.disableHardwareAcceleration` | `app.disable_hardware_acceleration` | `boolean` | `false` |

### Config file → BootConfig

| Source (file / field) | Target Key | Type | Default |
|---|---|---|---|
| `~/.cherrystudio/config/config.json` → `appDataPath` | `app.user_data_path` | `Record<string, string>` | *(null — see below)* |

**Why `defaultValue: null` for config-file entries**: the other sources fall back to `DefaultBootConfig[targetKey]` when the source has no value, so missing keys get sensible defaults. For config-file data like `app.user_data_path`, "no v1 file" must mean "nothing to migrate" — writing the schema default `{}` would be a spurious migration. Setting `defaultValue: null` on these entries routes them through the shared null-skip guard in `prepare()`, skipping the item entirely when the reader returns `null`.

## Data Quality Handling

| Issue | Detection | Handling |
|---|---|---|
| v1 file missing | `!fs.existsSync(path)` in reader | Reader returns `null` → migrator skips `app.user_data_path` |
| v1 file JSON parse error | `JSON.parse` throws in reader | Reader returns `null` → migrator skips |
| v1 file I/O error | `fs.readFileSync` throws | Reader returns `null` → migrator skips |
| `appDataPath` field missing | Not in parsed object | Reader returns `null` → migrator skips |
| `appDataPath` wrong type (e.g. number) | `typeof !== 'string' && !Array.isArray` | Reader returns `null` → migrator skips |
| `appDataPath: []` or array with all invalid entries | Filtered record has 0 keys | Reader returns `null` → migrator skips (C1 correctness — must not write `{}`) |
| Redux source missing a key | `reduxData` path lookup returns undefined | Falls back to `DefaultBootConfig[targetKey]` (e.g. `app.disable_hardware_acceleration` → `false`) |

## Writes and Validation

- Writes via `bootConfigService.set(targetKey, value)` followed by `bootConfigService.flush()` to force an immediate durable write.
- `validate()` iterates `preparedItems` and checks `bootConfigService.get(targetKey) !== undefined`.
- **Known validate weakness**: for `Record<string, string>` keys like `app.user_data_path`, `mergeDefaults()` fills a `{}` default on get, so `value !== undefined` is always true. The validation step cannot detect a silent write failure for Record-typed keys. Unit tests in `__tests__/BootConfigMigrator.test.ts` compensate by directly asserting `bootConfigService.get('app.user_data_path')` returns the expected structure rather than relying on validate().

## Implementation Files

- `BootConfigMigrator.ts` — `prepare/execute/validate` phases; `loadMigrationItems()` merges classification-derived mappings (from `BootConfigMappings.ts`) with the inline `configFileMappings` local const.
- `../utils/LegacyHomeConfigReader.ts` — sync reader for v1 home config file; read-only; does not validate path accessibility of the returned `dataPath` values.
- `mappings/BootConfigMappings.ts` — auto-generated mappings for the 4 classification-driven sources. The `targetKey: BootConfigKey` type annotation (emitted by `generate-migration.js`) provides the regen safety net: if a key is removed from the schema, mapping references fail to compile.
- `../../../../../packages/shared/data/bootConfig/bootConfigSchemas.ts` — fully auto-generated schema (classification keys + `MANUAL_BOOT_CONFIG_ITEMS` from `generate-boot-config.js`). Single `BootConfigSchema` interface, single `DefaultBootConfig` const.

## AppImage / Windows Portable Executable Path

On AppImage Linux and Windows portable builds, v1's `init.ts:51-60` writes a **special** `executablePath` into `config.json`:

- AppImage: `path.dirname(APPIMAGE) + '/cherry-studio.appimage'`
- Windows portable: `PORTABLE_EXECUTABLE_DIR + '/cherry-studio-portable.exe'`

These differ from `app.getPath('exe')`. `LegacyHomeConfigReader` does NOT reproduce this normalization — array entries are migrated verbatim with their original `executablePath` key, and the legacy-string fallback uses raw `app.getPath('exe')`.

**Migration-time impact is resolved**: `resolveMigrationPaths()` in `core/MigrationPaths.ts` performs its own legacy config detection using `getNormalizedExecutablePath()` (from `userDataLocation.ts`), which correctly normalizes AppImage/portable exe paths. This runs before the migration engine starts, ensuring the correct userData is used for all migration operations. `LegacyHomeConfigReader` still uses raw `app.getPath('exe')` for the BootConfig migration write, but the consumer side (`resolveUserDataLocation()`) also uses the normalized path for lookup, so both sides match for array-format entries. For string-format entries, `LegacyHomeConfigReader` keys by raw exe while the preboot lookup uses normalized exe — this mismatch is harmless because `resolveMigrationPaths()` has already pre-written the correct normalized-key entry to boot-config.json.

## Code Quality

All implementation code includes detailed comments:
- File-level comments: describe sources and write target
- Type-level comments: explain why `MigrationItem.targetKey` is `BootConfigKey` (regen safety net) and why `configFileMappings` is inline rather than in an auto-generated file
- Logic-level comments: explain the `defaultValue: null` semantic for config-file items (vs fallback-to-default for other sources)
