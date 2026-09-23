# McpServerMigrator

Migrates MCP server configurations from Redux to SQLite.

## Data Sources

| Source | Path | Description |
|--------|------|-------------|
| Redux | `state.mcp.servers` | Array of McpServer objects |

## Target Table

`mcp_server` (defined in `src/main/data/db/schemas/mcpServer.ts`)

## Skipped Fields (Runtime/Cache)

| Field | Reason | V2 Target |
|-------|--------|-----------|
| `isUvInstalled`, `isBunInstalled` | Derived from live binary availability | Not persisted |

## Not Migrated (Regenerable Cache)

| Source | Reason | V2 Target |
|--------|--------|-----------|
| Dexie `mcp:provider:*:servers` | Re-fetched from provider API | Handled in separate PR |

## Field Mappings

All McpServer fields are mapped 1:1 at the Drizzle ORM level (camelCase property names). The underlying SQLite columns use snake_case (e.g., `baseUrl` → `base_url`), handled automatically by Drizzle.

Scalar columns are **coerced**, not passed through: legacy records are unvalidated, so a value of the wrong shape or range would otherwise break the insert or the later read. The Transform column names the rule; [Legacy Value Coercion](#legacy-value-coercion-and-row-level-recovery) below states what each one does.

| Source Field | Target Column | Transform |
|---|---|---|
| `id` | `id` | Direct (PK) |
| `name` | `name` | `toRequiredString` — falls back to the generated `id` when missing/empty/whitespace-only |
| `type` | `type` | `toMcpServerType` |
| `description` | `description` | `toNullableString` |
| `baseUrl` / `url` | `baseUrl` | `toNullableString`, falling back from `url` when `baseUrl` is absent (legacy SSE servers) |
| `command` | `command` | `toNullableString` |
| `registryUrl` | `registryUrl` | `toNullableString` |
| `args` | `args` | JSON array via `toNullable` |
| `env` | `env` | JSON object via `toNullable` |
| `headers` | `headers` | JSON object via `toNullable` |
| `provider` | `provider` | `toNullableString` |
| `providerUrl` | `providerUrl` | `toNullableString` |
| `logoUrl` | `logoUrl` | `toNullableString` |
| `tags` | `tags` | JSON array via `toNullable` |
| `longRunning` | `longRunning` | `toNullableBoolean` |
| `timeout` | `timeout` | `toNullableInteger` — an unsafe integer becomes `null` |
| `dxtVersion` | `dxtVersion` | `toNullableString` |
| `dxtPath` | `dxtPath` | `toNullableString` |
| `reference` | `reference` | `toNullableString` |
| `searchKey` | `searchKey` | `toNullableString` |
| `configSample` | `configSample` | JSON object via `toNullable` |
| `disabledTools` | `disabledTools` | JSON array via `toNullable` |
| `disabledAutoApproveTools` | `disabledAutoApproveTools` | JSON array via `toNullable` |
| `shouldConfig` | `shouldConfig` | `toNullableBoolean` |
| `isActive` | `isActive` | `toNullableBoolean`, falling back to `false` (NOT NULL) |
| `installSource` | `installSource` | `toInstallSource` — a known source passes through, anything else becomes `null` |
| `isTrusted` | `isTrusted` | `toNullableBoolean` |
| `trustedAt` | `trustedAt` | `toNullableInteger` (timestamp) — an unsafe integer becomes `null` |
| `installedAt` | `installedAt` | `toNullableInteger` (timestamp) — an unsafe integer becomes `null` |
| — | `sortOrder` | The record's index in the source `mcp.servers` array (source order is preserved) |

## Edge Cases

- **Missing `id`**: Server is skipped with warning
- **Empty `id`**: Server is skipped with warning
- **Missing/empty/whitespace-only `name`**: Uses the generated `id` as the migrated name
- **Duplicate `id`**: Second occurrence is skipped, first is kept
- **Missing `isActive`**: Defaults to `false`
- **`undefined`/`null` optional fields**: Stored as `null` in SQLite

## Legacy Value Coercion and Row-Level Recovery

Legacy `mcp.servers` records were written by many app versions and are not validated on read, so a scalar
column can meet a value of the wrong shape (an object or array where a string is expected, a string where a
number or boolean is expected). better-sqlite3 binds an array as a positional parameter list and an object as
named parameters, so one such row made the whole batched `INSERT` fail with "Too few/Too many parameter values
were provided" (#20301). `McpServerMappings` therefore coerces scalar columns before the insert:

| Column | Rule (`McpServerMappings.ts`) |
|---|---|
| `type` | `toMcpServerType`: one of `stdio`, `sse`, `streamableHttp`, `inMemory` passes through; any other string containing `http` becomes `streamableHttp`; anything else becomes `null` |
| Nullable strings (`description`, `baseUrl`, `command`, `registryUrl`, `provider`, `providerUrl`, `logoUrl`, `dxtVersion`, `dxtPath`, `reference`, `searchKey`) | `toNullableString`: strings pass through; numbers and booleans are stringified; anything else (objects, arrays, `null`, `undefined`) becomes `null` |
| Nullable integers (`timeout`, `trustedAt`, `installedAt`) | `toNullableInteger`: numbers are truncated to integers; numeric strings are parsed; a `Date` becomes its timestamp; the result is kept only if it is a safe integer, since an `integer()` column stores a non-integral double as REAL and an integer at or beyond 2^53 reads back as a `RangeError`; anything else becomes `null` |
| Nullable booleans (`longRunning`, `shouldConfig`, `isTrusted`, `isActive`) | `toNullableBoolean`: booleans pass through; numbers become `value !== 0`; the strings `"true"` / `"false"` are accepted; anything else becomes `null`. `isActive` additionally falls back to `false` |
| JSON columns (`args`, `env`, `headers`, `tags`, `configSample`, `disabledTools`, `disabledAutoApproveTools`) | `toNullable`: the value is stored as is; `undefined` becomes `null` |
| `installSource` | `toInstallSource`: one of `builtin`, `manual`, `ai_assisted`, `protocol`, `unknown` passes through; anything else becomes `null` |

`execute` inserts in batches of 100. If a batch insert throws, the batch is retried row by row: a row that still
fails is skipped with a warning, excluded from `mcpServerIdMapping` (so assistants lose that reference) and
counted in `validate`'s `skippedCount`. If **no** row of the batch can be inserted individually, the failure is
database-wide (locked file, missing table, closed connection) rather than bad data, and the migration fails
instead of completing with an empty table.

## Execution Order

`order = 1.5` (after PreferencesMigrator=1, before AssistantMigrator=2)
