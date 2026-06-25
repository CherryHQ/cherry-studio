# BinaryManager Reference

BinaryManager is the single lifecycle service responsible for acquiring and managing third-party CLI binaries (uv, bun, ripgrep, claude-code, gh, etc.). It wraps [mise](https://mise.jdx.dev) as the only acquisition backend.

> **Why mise, no custom backend interface?** mise already ships a polyglot tool grammar (`npm:`, `pipx:`, `github:`, `http:`, plus its built-in registry). Building a `BinaryBackend` abstraction over the top would be a shallow wrapper that re-implements grammar mise already owns. We delete more code by importing mise's primitives directly than by hiding them behind our own seam.

## Quick links

- Implementation: `src/main/services/BinaryManager.ts`
- IPC channels: `src/shared/IpcChannel.ts` (`Binary_*`)
- Persisted state: `feature.binary.tools` preference + `feature.binary.state_file` path
- Preset catalog: `src/shared/data/presets/binary-tools.ts`
- Renderer entry point: `src/renderer/pages/settings/McpSettings/EnvironmentDependencies.tsx`

## Scope: what belongs and what doesn't

> BinaryManager manages **single, relocatable CLI binaries installable via mise's backends**. Multi-file server packages, tools requiring host hardware detection, or tools that generate their own configuration belong with their domain service.

| Tool | Status | Reason |
|---|---|---|
| uv, bun, ripgrep | **In** — bundled + mise-managed | Single relocatable binaries |
| fd, rtk | **In** — mise-managed | Single relocatable binaries installed on demand |
| claude-code, gh, opencode, gemini-cli, etc. | **In** — mise-managed | Installable via `npm:` / `pipx:` / mise registry |
| OvmsManager | **Out** — domain service | OS-specific multi-file tarball, hardware detection, generated config |
| Tesseract (`feature.ocr.tesseract`) | **Out** — data/models | Not a CLI binary; OCR data files live with `TesseractRuntimeService` |

When adding a new tool, ask: *can mise install this as a single binary?* If yes, it goes in BinaryManager. If it needs hardware checks, multi-file extraction, or post-install patching, it stays with its domain service.

## Persisted / contract surface

These are the stable boundaries that survive across versions and renderer reloads. Treat them as the public API:

| Surface | Value | Used by |
|---|---|---|
| Preference key | `feature.binary.tools` → `ManagedBinary[]` | Renderer custom-tool list |
| Path key | `feature.binary.data` → `~/.cherrystudio/binary-manager` | mise install root |
| Path key | `feature.binary.state_file` → `~/.cherrystudio/binary-manager/state.json` | Install state on disk |
| Path key | `cherry.bin` → `~/.cherrystudio/bin` | Bundled-binary extraction target |
| IPC | `binary:install-tool`, `binary:remove-tool`, `binary:get-state`, `binary:search-registry`, `binary:get-tool-dir`, `binary:probe-bundled` | Renderer → main |
| IPC events | `binary:state-changed`, `binary:reconcile-failed` | Main → renderer |
| Types | `ManagedBinary`, `BinaryState`, `ToolInstallState` (`src/shared/data/preference/preferenceTypes.ts`) | Both sides |

`ManagedBinary` is `{ name, tool, version? }` where `tool` is a mise tool spec (`npm:foo`, `pipx:bar`, `gh`, `claude`, …). Adding new fields requires regenerating preference schemas via `cd v2-refactor-temp/tools/data-classify && npm run generate`.

> **No v1→v2 migrator.** v2 data is throwaway per [CLAUDE.md](../../../CLAUDE.md) — the v2 pref key (`feature.binary.tools`) has no predecessor in v1, so there is intentionally nothing to migrate.

## Path resolution: one resolver, two sources

```text
getBinaryPath(name)  →  mise shim → cherry.bin → binary name (PATH fallback)
                        ────────   ──────────   ─────────────────────────────
                        mise-managed bundled     resolved by user shell at exec
```

`getBinaryPath()` in `src/main/utils/process.ts` is the **only** path resolver. Direct `os.homedir() + HOME_CHERRY_DIR` joins are forbidden — use `application.getPath('cherry.bin')` / `application.getPath('feature.binary.data')` instead.

## Why state is a file, not DataApi / Preference

BinaryManager state is operational cache for installed shim metadata, not user-authored business data. It must be readable before renderer windows exist, written atomically alongside the tool manager's filesystem operations, and safe to rebuild from `mise` plus the user's `feature.binary.tools` preference if lost. A small JSON file keeps that operational state close to the binaries it describes without adding a SQLite/DataApi boundary for non-business data.

## State contract: bundled vs mise-managed

Three sources for a tool to be available, in order of precedence:

| State | Detected by | UI label |
|---|---|---|
| **managed (mise)** | `BinaryState.tools[name]` is set after `mise use -g` | "v1.2.3" version chip |
| **available (bundled)** | `binary:probe-bundled` finds the binary in `cherry.bin` after extraction | "bundled" chip + "Install via mise" CTA |
| **not installed** | Neither of the above | "Install" CTA |

**Why we don't seed `BinaryState` on extraction:** BinaryState is the authoritative record of "user actively installed via mise". Writing extraction artifacts into it would conflate two sources (build-time bundled vs runtime user-installed), force a `source` discriminator on every entry, and cause state drift every time a release ships with a new bundled version. The probe-bundled IPC keeps the two sources orthogonal: BinaryState answers "what did the user install?", the filesystem probe answers "what shipped in the box?".

The bundled set is currently `bun`, `uv`, `rg`. mise itself is also bundled but is internal infrastructure, not user-visible. RTK is installed on demand from Settings → Plugins instead of being extracted automatically at startup.

**Precedence when both sources are present.** `getBinarySearchDirs()` lists the mise shims directory before `cherry.bin`, so if a user clicks *Install via mise* on a bundled tool (e.g. `uv`), the mise-managed version wins at `getBinaryPath('uv')` and consumers immediately use the newer copy. The bundled copy stays on disk as a fallback when the mise shim is absent or broken; the UI re-probes after install and updates the "managed / bundled" label accordingly.

## GitHub rate-limit opt-in

mise's `github:` backend (used by `github:larksuite/cli`, `github:sharkdp/fd`, etc.) hits the GitHub releases API to resolve versions. The unauthenticated limit is 60 req/hour per IP — easily exhausted behind shared NAT (offices, mainland-China ISPs, Codespaces, CI).

`BinaryManager.buildIsolatedEnv()` does **not** forward the ambient `GITHUB_TOKEN` / `GH_TOKEN` from the user's shell, to avoid leaking a general-purpose dev token into mise's process env without consent. Users who hit the rate limit can opt in by setting `CHERRY_GITHUB_TOKEN` in their shell before launching Cherry; it is forwarded to mise as `GITHUB_TOKEN`, raising the limit to 5000 req/hour.

```bash
export CHERRY_GITHUB_TOKEN=ghp_xxx   # optional, only needed if installs fail with HTTP 403
```

## China mirror behavior

`BinaryManager.buildIsolatedEnv()` calls `isUserInChina()` and, when true, injects mirror URLs into the mise subprocess env:

- `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com`
- `PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`

These are passthrough — if the user already has either var in their shell env, the user value wins. Mirror selection happens once per app launch and applies to all `npm:` / `pipx:` backends without per-tool configuration.

## Adding a new managed binary

**Preset (built-in tool, appears in the predefined list):**

1. Add an entry to `PRESETS_BINARY_TOOLS` in `src/shared/data/presets/binary-tools.ts`:
   ```ts
   {
     name: 'gh',           // executable name (also the mise shim name)
     displayName: 'GitHub CLI',
     tool: 'gh',           // mise tool spec — registry entry, npm:..., pipx:..., etc.
     description: '...',
     repoUrl: 'https://github.com/cli/cli'
   }
   ```
2. Add a description translation key under `settings.plugins.tools.<name>` in `src/renderer/i18n/locales/en-us.json`, then run `pnpm i18n:sync`.
3. No code change in BinaryManager — the renderer picks it up via the preset list.

**Custom (user-added from the settings UI):**

1. User clicks "Add Tool" and selects a registry result.
2. Renderer writes to `feature.binary.tools` preference after `binary:install-tool` succeeds; BinaryManager reconciles saved tools during startup.

**To bundle the binary at build time** (so it's available without mise install — only for tools small enough to ship):

1. Add the tool to `scripts/download-binaries.js` with platform-specific URLs and SHA256 checksums.
2. Add it to the `tools` array in `BinaryManager.extractBundledBinaries()`.
3. Add it to the `probeList` in `BinaryManager.probeBundled()` so the UI shows the "bundled" state correctly.

## Consumer pattern

From other main-process services:

```ts
const result = await application.get('BinaryManager').installTool({
  name: 'gh',
  tool: 'gh'
})
// result is { version: string }
```

Examples: `OpenClawService.install()` calls `installTool({name: 'openclaw', tool: 'npm:openclaw'})`; `CodeCliService.run()` calls `installTool()` lazily when the executable isn't on disk.

Do not re-implement install/uninstall logic in your service — delegate to BinaryManager and keep your service focused on runtime orchestration (config generation, process spawning, health checks).
