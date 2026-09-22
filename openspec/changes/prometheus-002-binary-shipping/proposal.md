## Why

Two Rust MCP servers must ship with the app: `compass` and `rust-mcp-filesystem`. Neither can be a
submodule here — they are Rust workspaces and nothing in an Electron build compiles Rust, so
vendoring their source would clone code this repo can never use. The mini vendors the source; The
Boss consumes built artifacts.

The mechanism already exists and needs no new machinery. `scripts/download-binaries.js` ships
`mise`, `bun`, `uv`, `rg` and `mingit` keyed by `platform-arch`, with SHA-256 verification, a
cross-worktree hard-linked cache and a 14-day TTL; `before-pack.js:190` invokes it per target and
`:194` calls `verifyBundledBinaries()`. Resolution into MCP already exists too:
`mcpLaunch.ts` resolves a stdio server's command through `getBinaryPath` and reports
`resolution: 'system' | 'bundled' | 'unresolved'`, and `binaryResolver.ts:15-17` appends `.exe` on
Windows.

## What Changes

- Two `TOOLS[]` entries. Compass's release emits `compass-<target>.tar.gz` plus a `.sha256`
  sidecar extracting to `compass-<target>/`, which maps onto the manifest's
  `url` / `archive` / `sha256` / `strip` fields directly.
- Both cover the five targets the app ships: `win32-x64`, `win32-arm64`, `darwin-arm64`,
  `darwin-x64` and `linux-x64`.
- Register `compass` as a **stdio** MCP server. Never `--transport http`, never `watch`.
- `rust-mcp-filesystem` is registered with **write disabled**.

## Impact

- Affected: `scripts/download-binaries.js` (`TOOLS[]`), MCP server registration, `resources/binaries/`.
- **Blocked on** releases existing for both (mini change `the-boss-release-infrastructure`). The
  `sha256` fields cannot be written before then, and a placeholder digest would defeat the
  verification that makes this pipeline safe.
- Security (A-3): a downloaded executable is a real trust boundary. Every entry carries a SHA-256
  verified before use, exactly as the five existing tools do; no entry may omit it.

## Non-goals

- Bundling `sycophancy-correction` — it has no release pipeline yet.
- HTTP transport for compass, in any form.
- Changing the download/cache/verify machinery itself.
