## Why

Every Prometheus tool that speaks MCP must appear in the app's MCP server list beside the existing
thirteen presets, and be configurable there — not be a hidden, hard-wired connection.

The mechanism exists: `PRESET_MCP_SERVERS` (`src/shared/data/presets/mcpServers.ts`) is the single
source of truth the renderer lists for install and `BuiltinMcpServerSeeder` reconciles installed
rows against, with the `mcp_server` table carrying `command`, `args`, `env`, `provider`,
`isActive`, `disabledTools` and `disabledAutoApproveTools`.

`prometheus-002` bundles the binaries; nothing yet **registers them as servers a user can see**.

## What Changes

Add presets for every Prometheus tool that exposes an MCP server:

| Tool | Transport | Source | Notes |
|---|---|---|---|
| `compass` | stdio | bundled binary (`prometheus-002`) | `serve --transport stdio`. Never HTTP, never watch. |
| `rust-mcp-filesystem` | stdio | bundled binary (`prometheus-002`) | Write tools in `disabledAutoApproveTools`, mirroring the existing `@cherry/filesystem` preset's `filesystemManualApprovalTools`. |
| `sycophancy-correction` | stdio | bundled binary, **once it has a release** | `--config <skill.toml>` per the mini's `mcpServerConfig()`. Blocked on `the-boss-release-infrastructure` §4. |
| `surreal-memory` | streamableHttp | Docker (`prometheus-004`) | `http://localhost:23001/mcp/sse`. Inactive until the container runs. |

`BuiltinMcpServerNames` is a **closed union** (`src/shared/utils/mcp.ts:6-23`); each name is added
there, namespaced `@prometheus/*` rather than `@cherry/*` so ownership is legible.

Commands resolve through the existing `getBinaryPath` path, so a bundled binary is found and `.exe`
is appended on Windows without any preset carrying a platform branch.

## Impact

- Affected: `src/shared/utils/mcp.ts` (union), `src/shared/data/presets/mcpServers.ts` (presets),
  i18n for each description.
- `BuiltinMcpServerSeeder`'s version is `hashObject(PRESET_MCP_SERVERS)`, so adding presets
  re-versions the seeder — intended, and how installed rows pick up the new set.
- **Blocked on `prometheus-002`** for the three bundled binaries, and on
  `the-boss-release-infrastructure` §4 for sycophancy-correction specifically.
- All four ship `isActive: false`: a preset is offered, not silently switched on.

## Non-goals

- Auto-enabling any server.
- HTTP transport for compass.
- Registering `pk` — it is a CLI the Karpathy flow spawns directly, not an MCP server.
