# BinaryManager Reference

BinaryManager is the single lifecycle service responsible for acquiring and managing third-party CLI binaries (uv, bun, ripgrep, claude-code, gh, etc.). It wraps [mise](https://mise.jdx.dev) as the only acquisition backend.

> **Why mise, no custom backend interface?** mise already ships a polyglot tool grammar (`npm:`, `pipx:`, `github:`, `http:`, plus its built-in registry). Building a `BinaryBackend` abstraction over the top would be a shallow wrapper that re-implements grammar mise already owns. We delete more code by importing mise's primitives directly than by hiding them behind our own seam.

## Quick links

- Implementation: `src/main/services/BinaryManager.ts`
- IPC channels: `src/shared/ipc/schemas/binary.ts` (`binary.*`)
- Persisted state: `feature.binary.tools` preference + `feature.binary.state_file` path
- Preset catalog: `src/shared/data/presets/binaryTools.ts`
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
| Shared cache key | `feature.binary.latest_versions` → `Record<string, string>` | Session latest-version results |
| IPC | `binary.install_tool`, `binary.remove_tool`, `binary.get_state`, `binary.search_registry`, `binary.get_tool_dir`, `binary.probe_bundled`, `binary.probe_system`, `binary.get_latest_versions` | Renderer → main |
| IPC events | `binary.state_changed`, `binary.reconcile_failed` | Main → renderer |
| Types | `ManagedBinary`, `BinaryState`, `ToolInstallState` (`src/shared/data/preference/preferenceTypes.ts`) | Both sides |

`ManagedBinary` is `{ name, tool, version? }` where `tool` is a mise tool spec (`npm:foo`, `pipx:bar`, `gh`, `claude`, …). Adding new fields requires regenerating preference schemas via `cd v2-refactor-temp/tools/data-classify && npm run generate`.

`binary.get_latest_versions` is an on-demand update-check surface. `force=false` is a read-only cache lookup: it returns the current `feature.binary.latest_versions` shared-cache value, or `{}` when no session result exists. `force=true` runs `mise latest` for the current managed tools, omits failed lookups, and writes the confirmed result back to `feature.binary.latest_versions` only if the managed-tool snapshot has not changed during the batch. If every managed tool's lookup fails (offline, rate-limited), the IPC rejects so the caller can surface a failure. Install, remove, and state-mutation paths delete the shared cache so version hints do not survive a managed-set change.

> **No v1→v2 migrator.** v2 data is throwaway per [CLAUDE.md](../../../CLAUDE.md) — the v2 pref key (`feature.binary.tools`) has no predecessor in v1, so there is intentionally nothing to migrate.

## Path resolution: one resolver, two sources

```text
getBinaryPath(name)  →  mise shim → cherry.bin → binary name (PATH fallback)
                        ────────   ──────────   ─────────────────────────────
                        mise-managed bundled     resolved by user shell at exec
```

`getBinaryPath()` in `src/main/utils/binaryResolver.ts` is the **only** path resolver. Direct `os.homedir() + HOME_CHERRY_DIR` joins are forbidden — use `application.getPath('cherry.bin')` / `application.getPath('feature.binary.data')` instead.

## Why state is a file, not DataApi / Preference

BinaryManager state is operational cache for installed shim metadata, not user-authored business data. It must be readable before renderer windows exist, written atomically alongside the tool manager's filesystem operations, and safe to rebuild from `mise` plus the user's `feature.binary.tools` preference if lost. A small JSON file keeps that operational state close to the binaries it describes without adding a SQLite/DataApi boundary for non-business data.

## State contract: bundled vs mise-managed

Four sources for a tool to be available, in order of precedence:

| State | Detected by | UI label |
|---|---|---|
| **managed (mise)** | `BinaryState.tools[name]` is set after `mise use -g` | "v1.2.3" version chip |
| **available (bundled)** | `binary.probe_bundled` finds the binary in `cherry.bin` after extraction | "bundled" chip + low-key "Install via mise" |
| **available (system)** | `binary.probe_system` resolves the name on the user's login-shell PATH (outside Cherry's dirs) | "system" chip (path on hover) + low-key "Install via mise" |
| **not installed** | None of the above | prominent "Install" CTA |

`binary.probe_system` uses the captured login-shell env (`getShellEnv` + `findCommandInShellEnv`) so it sees the same PATH a terminal would, not the truncated GUI-launch PATH. Resolutions that land inside `cherry.bin` / `feature.binary.data` are dropped so a bundled/managed tool keeps its more specific source. "system" carries no version (that would cost a per-tool `--version` spawn); the goal is only to tell the user the tool is already usable. A prominent "Install" appears **only** for the not-installed state — the mise install stays available for already-present tools but is de-emphasized (it just yields a Cherry-managed, pinned copy).

**Why we don't seed `BinaryState` on extraction:** BinaryState is the authoritative record of "user actively installed via mise". Writing extraction artifacts into it would conflate two sources (build-time bundled vs runtime user-installed), force a `source` discriminator on every entry, and cause state drift every time a release ships with a new bundled version. The probe-bundled IPC keeps the two sources orthogonal: BinaryState answers "what did the user install?", the filesystem probe answers "what shipped in the box?".

The bundled set is currently `bun`, `uv`, `rg`. mise itself is also bundled but is internal infrastructure, not user-visible. RTK is installed on demand from Settings → Plugins instead of being extracted automatically at startup.

**Precedence when both sources are present.** `getBinarySearchDirs()` lists the mise shims directory before `cherry.bin`, so if a user clicks *Install via mise* on a bundled tool (e.g. `uv`), the mise-managed version wins at `getBinaryPath('uv')` and consumers immediately use the newer copy. The bundled copy stays on disk as a fallback when the mise shim is absent or broken; the UI re-probes after install and updates the "managed / bundled" label accordingly.

## GitHub rate-limit opt-in

mise's `github:` backend (used by `github:larksuite/cli`, `github:sharkdp/fd`, etc.) hits the GitHub releases API to resolve versions. The unauthenticated limit is 60 req/hour per IP — easily exhausted behind shared NAT (offices, mainland-China ISPs, Codespaces, CI).

`BinaryManager.buildIsolatedEnv()` does **not** forward the ambient `GITHUB_TOKEN` / `GH_TOKEN` from the user's shell, to avoid leaking a general-purpose dev token into mise's process env without consent. Users who hit the rate limit can set a token in **Settings → Dependencies → Advanced install settings** (see below), which is forwarded to mise as `GITHUB_TOKEN`, raising the limit to 5000 req/hour. When that field is empty, a `CHERRY_GITHUB_TOKEN` shell env var is used as a fallback:

```bash
export CHERRY_GITHUB_TOKEN=ghp_xxx   # optional fallback if the settings token is empty
```

## China mirror behavior

`BinaryManager.buildIsolatedEnv()` calls `isUserInChina()` and, when true (and no explicit registry override is configured — see below), injects mirror URLs into the mise subprocess env:

- `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com`
- `PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`

These are passthrough — if the user already has either var in their shell env, the user value wins. Mirror selection happens once per app launch and applies to all `npm:` / `pipx:` backends without per-tool configuration.

## Advanced install settings (UI)

**Settings → Dependencies → Advanced install settings** (collapsed by default) exposes the install knobs as the `feature.binary.install_settings` preference, consumed only by `buildIsolatedEnv()` (the install subprocess) — never the shared execution env that runs installed CLIs, so a token or mirror can't leak into launched agents. All fields default empty (verification on), i.e. the behavior above is unchanged until a user opts in. `BinaryManager` invalidates its memoized isolated env when this preference or the proxy prefs change.

| Field              | Effect                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `githubMirror`     | Proxy-prefix mirror (e.g. `https://ghfast.top`). Sets `MISE_URL_REPLACEMENTS` to rewrite **both** `https://github.com` and `https://api.github.com` (the latter is what `mise latest` resolves against). Empty = direct. |
| `npmRegistry`      | Overrides `NPM_CONFIG_REGISTRY`. Beats the China auto-mirror; empty keeps the auto behavior above.                                                        |
| `pipIndexUrl`      | Overrides `PIP_INDEX_URL`. Same auto-vs-explicit rule as npm.                                                                                             |
| `githubToken`      | Sets `GITHUB_TOKEN` (supersedes the `CHERRY_GITHUB_TOKEN` env). Stored as plaintext preference JSON — password-masked in the UI, never logged.            |
| `verifySignatures` | Default on. When off, sets `MISE_AQUA_COSIGN/SLSA/MINISIGN=false` — an escape hatch when aqua's Sigstore/SLSA verification can't complete.                 |

Presets for the URL fields (a short, opt-in, cheaply-updatable list — Cherry never routes downloads through a mirror unless picked) live in `src/shared/data/presets/binaryInstallPresets.ts`.

## Adding a new managed binary

**Preset (built-in tool, appears in the predefined list):**

1. Add an entry to `PRESETS_BINARY_TOOLS` in `src/shared/data/presets/binaryTools.ts`:
   ```ts
   {
     name: 'gh',           // executable name (also the mise shim name)
     displayName: 'GitHub CLI',
     tool: 'gh',           // mise tool spec — registry entry, npm:..., pipx:..., etc.
     icon: 'simple-icons:github', // optional iconify id
     repoUrl: 'https://github.com/cli/cli',
     homepage: 'https://cli.github.com/' // optional
   }
   ```
2. Add a description translation key under `settings.plugins.tools.<name>` in `src/renderer/i18n/locales/en-us.json`, then run `pnpm i18n:sync`.
3. No code change in BinaryManager — the renderer picks it up via the preset list.

   For a **coding agent**, also set `isAgent: true` (groups it under "Coding Agents" in the dependencies UI) and, when the agent is launchable from the Code Tools page, `codeCli: CodeCli.<ID>` — that wires an "Open in Code Tools" button on the card once the agent is available.

**Custom (user-added from the settings UI):**

1. User clicks "Add Tool" and selects a registry result.
2. Renderer writes to `feature.binary.tools` preference after `binary.install_tool` succeeds; BinaryManager reconciles saved tools during startup.

**To bundle the binary at build time** (so it's available without mise install — only for tools small enough to ship):

1. Add the tool to `scripts/download-binaries.js` with platform-specific URLs and SHA256 checksums.
2. Add it to the module-level `BUNDLED_TOOLS` array in `BinaryManager.ts` — a single source consumed by both `extractBundledBinaries()` (boot extraction) and `probeBundled()` (UI "bundled" state), so one entry wires up both.

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
