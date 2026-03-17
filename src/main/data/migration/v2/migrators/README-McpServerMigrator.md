# McpServerMigrator

Migrates MCP server configurations from Redux to SQLite.

## Data Sources

| Source | Path | Description |
|--------|------|-------------|
| Redux | `state.mcp.servers` | Array of MCPServer objects |

## Target Table

`mcp_server` (defined in `src/main/data/db/schemas/mcpServer.ts`)

## Skipped Fields (Runtime/Cache)

| Field | Reason | V2 Target |
|-------|--------|-----------|
| `isUvInstalled` | Re-detected at startup | `usePersistCache('mcp.is_uv_installed')` |
| `isBunInstalled` | Re-detected at startup | `usePersistCache('mcp.is_bun_installed')` |

## Not Migrated (Regenerable Cache)

| Source | Reason | V2 Target |
|--------|--------|-----------|
| Dexie `mcp:provider:*:servers` | Re-fetched from provider API | `usePersistCache('mcp.provider_catalogs')` |

## Field Mappings

All MCPServer fields are mapped 1:1 (no renames needed since the schema uses the same camelCase names as the source):

| Source Field | Target Column | Transform |
|---|---|---|
| `id` | `id` | Direct (PK) |
| `name` | `name` | Direct (NOT NULL) |
| `type` | `type` | Nullable passthrough |
| `description` | `description` | Nullable passthrough |
| `baseUrl` | `baseUrl` | Nullable passthrough |
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
- **Duplicate `id`**: Second occurrence is skipped, first is kept
- **Missing `isActive`**: Defaults to `false`
- **`undefined`/`null` optional fields**: Stored as `null` in SQLite

## Execution Order

`order = 2` (after PreferencesMigrator=1, before AssistantMigrator which may reference MCP servers)
