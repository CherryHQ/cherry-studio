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

All McpServer fields are mapped 1:1 at the Drizzle ORM level (camelCase property names). The underlying SQLite columns use snake_case (e.g., `baseUrl` → `base_url`), handled automatically by Drizzle:

| Source Field | Target Column | Transform |
|---|---|---|
| `id` | `id` | Direct (PK) |
| `name` | `name` | Uses source `name`; falls back to the generated `id` when missing/empty/whitespace-only |
| `type` | `type` | Nullable passthrough |
| `description` | `description` | Nullable passthrough |
| `baseUrl` / `url` | `baseUrl` | Falls back from `url` if `baseUrl` is absent (legacy SSE servers) |
| `command` | `command` | Nullable passthrough |
| `registryUrl` | `registryUrl` | Nullable passthrough |
| `args` | `args` | JSON array |
| `env` | `env` | JSON object |
| `headers` | `headers` | JSON object |
| `provider` | `provider` | Nullable passthrough |
| `providerUrl` | `providerUrl` | Nullable passthrough |
| `logoUrl` | `logoUrl` | Nullable passthrough |
| `tags` | `tags` | JSON array |
| `longRunning` | `longRunning` | Nullable boolean |
| `timeout` | `timeout` | Nullable integer |
| `dxtVersion` | `dxtVersion` | Nullable passthrough |
| `dxtPath` | `dxtPath` | Nullable passthrough |
| `reference` | `reference` | Nullable passthrough |
| `searchKey` | `searchKey` | Nullable passthrough |
| `configSample` | `configSample` | JSON object |
| `disabledTools` | `disabledTools` | JSON array |
| `disabledAutoApproveTools` | `disabledAutoApproveTools` | JSON array |
| `shouldConfig` | `shouldConfig` | Nullable boolean |
| `isActive` | `isActive` | Boolean (NOT NULL, default false) |
| `installSource` | `installSource` | Nullable passthrough |
| `isTrusted` | `isTrusted` | Nullable boolean |
| `trustedAt` | `trustedAt` | Nullable integer (timestamp) |
| `installedAt` | `installedAt` | Nullable integer (timestamp) |

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

| Column kind | Rule |
|---|---|
| Nullable strings (`type`, `description`, `baseUrl`, `command`, `registryUrl`, `logoUrl`, `provider`, `providerUrl`, `reference`, `timeout` text fields) | Strings pass through; anything else becomes `null` |
| Nullable integers (`timeout`, `longRunning` durations) | Finite numbers and numeric strings are accepted, everything else becomes `null` |
| Booleans (`isActive`, `disabledAutoApproveTools`, …) | Booleans pass through; `"true"`/`"false"` strings and `0`/`1` are accepted; `isActive` falls back to `false` |
| `installSource` | Must be one of `builtin`, `manual`, `ai_assisted`, `protocol`, `unknown`; anything else becomes `unknown` |

`execute` inserts in batches of 100. If a batch insert throws, the batch is retried row by row: a row that still
fails is skipped with a warning, excluded from `mcpServerIdMapping` (so assistants lose that reference) and
counted in `validate`'s `skippedCount`. If **no** row of the batch can be inserted individually, the failure is
database-wide (locked file, missing table, closed connection) rather than bad data, and the migration fails
instead of completing with an empty table.

## Execution Order

`order = 1.5` (after PreferencesMigrator=1, before AssistantMigrator=2)
