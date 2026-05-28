# BinaryManager Reference

BinaryManager is the single lifecycle service responsible for acquiring and managing third-party CLI binaries (uv, bun, ripgrep, claude-code, gh, etc.). It wraps [mise](https://mise.jdx.dev) as the only acquisition backend.

> **Why mise, no custom backend interface?** mise already ships a polyglot tool grammar (`npm:`, `pipx:`, `github:`, `http:`, plus its built-in registry). Building a `BinaryBackend` abstraction over the top would be a shallow wrapper that re-implements grammar mise already owns. We delete more code by importing mise's primitives directly than by hiding them behind our own seam.

## Quick links

- Implementation: `src/main/services/BinaryManager.ts`
- IPC channels: `packages/shared/IpcChannel.ts` (`Binary_*`)
- Persisted state: `feature.binaries.tools` preference + `feature.binaries.state_file` path
- Preset catalog: `packages/shared/data/presets/binary-tools.ts`
- Renderer entry point: `src/renderer/src/pages/settings/McpSettings/EnvironmentDependencies.tsx`

## Scope: what belongs and what doesn't

> BinaryManager manages **single, relocatable CLI binaries installable via mise's backends**. Multi-file server packages, tools requiring host hardware detection, or tools that generate their own configuration belong with their domain service.

| Tool | Status | Reason |
|---|---|---|
| uv, bun, ripgrep, fd, rtk | **In** — bundled + mise-managed | Single relocatable binaries |
| claude-code, gh, opencode, gemini-cli, etc. | **In** — mise-managed | Installable via `npm:` / `pipx:` / mise registry |
| OvmsManager | **Out** — domain service | OS-specific multi-file tarball, hardware detection, generated config |
| Tesseract (`appUserData/tesseract`) | **Out** — data/models | Not a CLI binary; OCR data files live with `OvOcrService` |

When adding a new tool, ask: *can mise install this as a single binary?* If yes, it goes in BinaryManager. If it needs hardware checks, multi-file extraction, or post-install patching, it stays with its domain service.

## Persisted / contract surface

These are the stable boundaries that survive across versions and renderer reloads. Treat them as the public API:

| Surface | Value | Used by |
|---|---|---|
| Preference key | `feature.binaries.tools` → `ManagedBinary[]` | Renderer custom-tool list |
| Path key | `feature.binaries.data` → `~/.cherrystudio/mise` | mise install root |
| Path key | `feature.binaries.state_file` → `~/.cherrystudio/mise/state.json` | Install state on disk |
| Path key | `cherry.bin` → `~/.cherrystudio/bin` | Bundled-binary extraction target |
| IPC | `binary:reconcile`, `binary:install-tool`, `binary:remove-tool`, `binary:get-state`, `binary:search-registry`, `binary:get-tool-dir`, `binary:probe-bundled` | Renderer → main |
| IPC events | `binary:state-changed`, `binary:reconcile-failed` | Main → renderer |
| Types | `ManagedBinary`, `BinaryState`, `ToolInstallState` (`packages/shared/data/preference/preferenceTypes.ts`) | Both sides |

`ManagedBinary` is `{ name, tool, version? }` where `tool` is a mise tool spec (`npm:foo`, `pipx:bar`, `gh`, `claude`, …). Adding new fields requires regenerating preference schemas via `cd v2-refactor-temp/tools/data-classify && npm run generate`.

> **No v1→v2 migrator.** v2 data is throwaway per [CLAUDE.md](../../../CLAUDE.md) — the v2 pref key (`feature.binaries.tools`) has no predecessor in v1, so there is intentionally nothing to migrate.

## Path resolution: one resolver, two sources

```
getBinaryPath(name)  →  mise shim → cherry.bin → binary name (PATH fallback)
                        ────────   ──────────   ─────────────────────────────
                        mise-managed bundled     resolved by user shell at exec
```

`getBinaryPath()` in `src/main/utils/process.ts` is the **only** path resolver. Direct `os.homedir() + HOME_CHERRY_DIR` joins are forbidden — use `application.getPath('cherry.bin')` / `application.getPath('feature.binaries.data')` instead.

## State contract: bundled vs mise-managed

Three sources for a tool to be available, in order of precedence:

| State | Detected by | UI label |
|---|---|---|
| **managed (mise)** | `BinaryState.tools[name]` is set after `mise use -g` | "v1.2.3" version chip |
| **available (bundled)** | `binary:probe-bundled` finds the binary in `cherry.bin` after extraction | "bundled" chip + "Install via mise" CTA |
| **not installed** | Neither of the above | "Install" CTA |

**Why we don't seed `BinaryState` on extraction:** BinaryState is the authoritative record of "user actively installed via mise". Writing extraction artifacts into it would conflate two sources (build-time bundled vs runtime user-installed), force a `source` discriminator on every entry, and cause state drift every time a release ships with a new bundled version. The probe-bundled IPC keeps the two sources orthogonal: BinaryState answers "what did the user install?", the filesystem probe answers "what shipped in the box?".

The bundled set is currently `bun`, `uv`, `rg`. mise itself is also bundled but is internal infrastructure, not user-visible.

**Precedence when both sources are present.** `getBinarySearchDirs()` lists the mise shims directory before `cherry.bin`, so if a user clicks *Install via mise* on a bundled tool (e.g. `uv`), the mise-managed version wins at `getBinaryPath('uv')` and consumers immediately use the newer copy. The bundled copy stays on disk as a fallback when the mise shim is absent or broken; the UI re-probes after install and updates the "managed / bundled" label accordingly.

## China mirror behavior

`BinaryManager.buildIsolatedEnv()` calls `isUserInChina()` and, when true, injects mirror URLs into the mise subprocess env:

- `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com`
- `PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`

These are passthrough — if the user already has either var in their shell env, the user value wins. Mirror selection happens once per install and applies to all `npm:` / `pipx:` backends without per-tool configuration.

## Adding a new managed binary

**Preset (built-in tool, appears in the predefined list):**

1. Add an entry to `PREDEFINED_BINARY_TOOLS` in `packages/shared/data/presets/binary-tools.ts`:
   ```ts
   {
     name: 'gh',           // executable name (also the mise shim name)
     displayName: 'GitHub CLI',
     tool: 'gh',           // mise tool spec — registry entry, npm:..., pipx:..., etc.
     description: '...',
     repoUrl: 'https://github.com/cli/cli'
   }
   ```
2. Add a description translation key under `settings.plugins.tools.<name>` in `src/renderer/src/i18n/locales/en-us.json`, then run `pnpm i18n:sync`.
3. No code change in BinaryManager — the renderer picks it up via the preset list.

**Custom (user-added from the settings UI):**

1. User clicks "Add Tool" and provides a name + mise spec.
2. Renderer writes to `feature.binaries.tools` preference; BinaryManager picks it up on the next reconcile.

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
// result is ToolInstallState — version, install path, timestamps
```

Examples: `OpenClawService.install()` calls `installTool({name: 'openclaw', tool: 'npm:openclaw'})`; `CodeCliService.run()` calls `installTool()` lazily when the executable isn't on disk.

Do not re-implement install/uninstall logic in your service — delegate to BinaryManager and keep your service focused on runtime orchestration (config generation, process spawning, health checks).
