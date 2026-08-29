---
description: Lifecycle service that acquires third-party CLI binaries through mise, with tool registry, snapshots, and IPC
sources:
  - src/main/services/binaryManager/BinaryManager.ts
  - src/main/services/binaryManager/pythonRuntime.ts
  - src/shared/data/presets/binaryTools.ts
  - src/main/ipc/handlers/binary.ts
  - scripts/download-binaries.js
---

# BinaryManager Reference

`BinaryManager` is the lifecycle service that acquires and manages third-party CLI binaries through [mise](https://mise.jdx.dev). It owns the custom tool registry and the filesystem/process orchestration around mise; domain services own execution, configuration, and health logic.

> **Why mise, not a custom backend interface?** mise already owns the polyglot tool grammar (`npm:`, `pipx:`, `github:`, `http:`, and its registry). A `BinaryBackend` wrapper would be a shallow abstraction that duplicates those semantics.

## Scope

BinaryManager is for a single CLI executable that mise can install (`npm:`, `pipx:`, `github:`, mise registry, and so on). It is not for multi-file server packages, hardware detection, generated configuration, or data/model downloads. Those remain with their domain service.

Examples in scope: `uv`, `bun`, `ripgrep`, `gh`, `claude-code`, and npm/pipx CLI tools. The bundled `mise` executable is internal infrastructure, not a user-facing managed tool.

## Tool definitions and runtime facts

Cherry manages two disjoint sets of tools. **Fixed tools** — every Dependencies preset (`PRESETS_BINARY_TOOLS`) and every Code CLI executable — are code-owned: their canonical mise recipe lives in the in-code `FIXED_CATALOG`, and they write **zero** Preference. **Custom tools** are user-added: each is a `CustomToolDefinition` (`{ name, tool, requestedVersion? }`) persisted in the `feature.binary.tools` custom registry. A persisted definition means the user added that tool; it does **not** prove that an executable exists right now.

Only the main process writes `feature.binary.tools`, through `BinaryManager.addCustomTool()` (persist-first Custom Add) and `BinaryManager.removeTool()`. `installByName()` never writes Preference — it resolves the fixed/custom recipe in main and applies it. The renderer sends commands and renders snapshots; it never writes definitions directly. There is no `state.json` or startup reconcile, so a restored custom registry does not automatically mutate the filesystem. A missing executable remains recoverable through the normal install path, while a custom definition remains removable. After `onAllReady` a lifecycle-owned, one-time `normalizeCustomDefinitions()` pass rewrites the registry to the canonical shape (dropping fixed-name entries, malformed entries, fixed-spec aliases, and duplicates, and mapping a legacy string `version` to `requestedVersion`) — schema hygiene only: it never installs, reconciles, or touches the filesystem. The hook schedules this work, and service stop cancels it before start or joins it once in flight. If a user mutation already holds the global mutex, hygiene yields to that operation and retries on the next launch rather than delaying shutdown behind an install.

mise is an availability backend, not a definition store. An executable visible to mise can have no custom definition; conversely, a defined custom tool can be unavailable after external deletion. Custom Add writes the definition first: if that write fails, no backend work starts; if backend application fails afterward, the definition remains and the snapshot carries a retryable failed operation.

Bundled copies are a separate availability source. The app extracts its shipped binaries to `cherry.bin`. The runtime lookup order is mise shim, bundled binary, then the user's login-shell PATH.

### Portable definitions and machine-local state

Backup and restore transport `feature.binary.tools` as portable custom definitions only. Restoring them can recreate custom cards and requested version pins on another machine, but it never installs tools, recreates backend application, or copies operation/latest-version state. Fixed definitions come from the running Cherry Studio build and are not backup data. After restore, each machine derives `application` and `availability` from its own mise state, bundled files, and system PATH.

## Snapshots

`getToolSnapshots(names)` is the one availability surface for renderer and main consumers. Each `BinaryToolSnapshot` combines four independent dimensions:

- `definition`: the user-added `CustomToolDefinition` backing this name; absent for a fixed tool.
- `application`: the exact-backend-application fact (`applied` / `broken` / `absent` / `conflict` / `unknown`) — whether the exact managed recipe is applied through mise, computed independently of `availability`. Only an `active: true` mise entry whose executable shim and `mise which` target are both runnable can be `applied`; installed but inactive entries are `broken`, and their shim contributes mise availability only when the same target check passes. A tool name is not always an executable — `core:rust` exposes `rustc`/`cargo` and no `rust` — so a recipe without an eponymous shim qualifies through a concrete executable `mise bin-paths --json` reports for it, and only when that executable clears the same bar: a shim that passes the platform-appropriate access check whose target `mise which --tool` still resolves for this recipe.
- `availability`: current `mise`, `bundled`, `system`, or `none` fact, including an executable path when available.
- `operation`: optional current install/remove state.

The returned record is intentionally a superset of the requested names. It also includes custom registry entries, active operation entries, and discovered `node`/`python` runtime dependencies from mise. Candidate recipes come from the fixed catalog and the custom registry only — an operation-only name carries no recipe and so omits its `application` fact. This lets a newly mounted settings window render a complete management view.

A snapshot obtains live mise data with one `mise ls --json` query and reports a mise executable only after its shim passes the platform-appropriate access check and `mise which` resolves an accessible target; the per-recipe `mise bin-paths --json` fallback above runs only for an installed tool that has no shim of its own. Post-install validation, prune verification, and snapshot derivation share that one runnable proof; they differ only in where the active install entry comes from (a per-recipe `mise ls` for the former two, the batched listing for the latter). System discovery uses the raw login-shell environment so Cherry's directories and `MISE_*` settings cannot make a Cherry executable look like a system executable.

Snapshots are weakly consistent by design: they do not wait on the mutation mutex. The custom registry, operation cache, mise output, and filesystem may change while a snapshot is assembled. Consumers must treat a snapshot as a display/execution decision for that moment, refresh on `binary.availability_changed`, and drive update/uninstall/repair from `application`, never from `availability` alone.

### Application and action matrix

`availability` authorizes execution; `application` authorizes backend mutation. System and bundled executables are external to BinaryManager and are never updated or removed.

| Definition kind | Application / availability | UI actions |
| --- | --- | --- |
| Fixed | `applied` | Update, Uninstall; the fixed card remains after Uninstall |
| Fixed | `broken` | Retry, Uninstall |
| Fixed | `absent` + `none` | Install |
| Fixed | `absent` + bundled/system | Read-only; Code CLI may Launch |
| Fixed | `conflict` | No backend mutation; Code CLI may Launch the verified executable |
| Fixed | `unknown` | Retry/probe only; never Uninstall |
| Custom | `applied` | Update, Remove |
| Custom | `broken` | Retry, Remove |
| Custom | `absent` + `none` | Install, Remove |
| Custom | `absent` + bundled/system | Remove definition; never install a shadow copy |
| Custom | `conflict` | Remove flow only; cleanup must fail closed before definition-only fallback |
| Custom | `unknown` | Retry/probe or Remove flow; never assume backend cleanup is safe |

Remove is one custom-tool product flow: it first attempts verified backend cleanup, then deletes the definition. Only after a typed `cleanup_blocked` result may the UI offer a second, explicit definition-only confirmation warning that backend files may remain. Fixed tools have no definition-only fallback.

## Mutation behavior

Install and remove mutations are serialized with the custom registry and mise process operations. Per-tool active-operation guards deduplicate an identical install and reject conflicting install/remove requests before they overwrite each other's state.

There are two install routes. `installByName({ name, targetVersion? })` resolves the code-owned fixed recipe or the persisted custom definition and applies it against the live `application` fact — it never writes Preference. An already-applied tool is a no-op (or a one-shot version update when a target is given); an externally satisfied (bundled/system) tool is a logged no-op so a race converges; a `conflict`/`unknown` state rejects without mutating; a backend failure records a failed operation. `addCustomTool(definition)` is the only route that accepts an arbitrary recipe: it validates grammar and collisions, then persists the definition to the registry **before** any backend work, so the tool stays defined and retry-able even if the install fails. An already-applied tool short-circuits only when its active version provably satisfies `requestedVersion` (or none was requested); a mismatched or unprovable version runs the targeted installation. Neither route ever rewrites the persisted definition with a resolved/installed version.

After a one-shot version update is installed and proven runnable, BinaryManager runs a tool-filtered `mise prune <tool>` to remove older versions that are no longer referenced by mise configuration. It then reshims and verifies the active executable again. A prune command failure is logged without turning the already-successful update into a failed install; fresh installs and name-only repair operations do not run this cleanup.

Both publish `installing` before waiting for the global mutation lock and clear or fail the operation under it. A failed operation carries `{ status, action, error }` plus, for a failed one-shot update, the `targetVersion` it was applying — so Retry repeats the same targeted update instead of degrading to a name-only no-op. It never carries a recipe, because the recipe is always re-resolvable from the fixed catalog or the custom registry.

Removal publishes `removing` and chooses its cleanup path from the live `application` fact (never the persisted definition). An absent fixed tool is an idempotent success; an absent custom tool drops only its definition. For an applied or broken exact recipe, BinaryManager removes the mise tool, reshims, verifies absence, and only then drops a custom definition — a fixed tool keeps its catalog identity and writes no Preference. `definitionOnly` drops just a custom definition without touching the backend. A blocked cleanup returns a typed `cleanup_blocked` result and retains the definition, so the UI cannot accidentally replace a removal failure with an install retry.

Runtime dependencies have one extra rule. If an existing `node` or `python` shim satisfies the requested version, an install adopts it at its observed version rather than reinstalling. A version mismatch runs mise installation instead. This avoids silently replacing a usable runtime.

Removing a runtime is guarded symmetrically. Under the mutation lock, removal of a `node` runtime is rejected while any installed `npm:` tool remains, and a `python` runtime while any installed `pipx:` tool remains — those package tools depend on the runtime's interpreter, so pulling it would strand them. The rejection names the blocking tools; the check reuses the install-side backend→runtime map (npm→node, pipx→python) rather than a dependency graph. The `pipx` half of that guard now covers only tools an earlier Cherry version installed: their virtual environments were built against mise's Python and still bind to it, while a tool installed since gets the Cherry-provisioned interpreter below and does not.

### Python for the pipx backend

Python is the one runtime BinaryManager does not ask mise for. mise installs Python from GitHub releases, which is unreachable from mainland China, and naming a Python runtime in `mise use` is what triggers that download — so `pythonRuntime.ts` provisions the interpreter with the bundled `uv` into `feature.binary.data.uv_python`, and `mise use` is given the `pipx:` tool alone. `UV_PYTHON` carries the interpreter into mise's pipx backend, which shells out to uv. In China the archive comes from npmmirror's `python-build-standalone` mirror first, the official source second; uv verifies both against its built-in catalog's checksums. Provisioning first asks `uv python find` for an interpreter and spawns it with `--version` — a half-written download is otherwise indistinguishable from a working one. Every install then passes `--reinstall` unconditionally: a plain `uv python install` treats any version uv still lists as already satisfied, and `uv python find` reports an interpreter it cannot inspect exactly as it reports an absent one, so there is no state in which the flag can be skipped safely. On an empty install directory it simply downloads.

After a successful `pipx:` install, BinaryManager drops the global `python` selection with `mise unuse -g --no-prune python`: earlier versions wrote that entry for themselves and leaving it behind keeps mise reporting a runtime it no longer owns as active. `--no-prune` is required, not cosmetic — plain `mise unuse` uninstalls the version as well, and a `pipx:` tool installed by an earlier version has a `pyvenv.cfg` pointing straight into that install directory. The step is skipped when the user added Python as a custom tool, since that selection is theirs, and a failure is logged rather than failing an install that already succeeded.

### Failure outcomes

| Failure point | Authoritative outcome |
| --- | --- |
| Custom definition write during Add | Add stops before backend work; no card is created |
| Backend application after Custom Add | Definition remains; failed operation exposes Retry |
| Fixed/custom Install or Update | Recipe source is unchanged; failed operation exposes Retry where safe |
| Backend query/conflict during Remove | `cleanup_blocked`; backend and custom definition remain unchanged |
| Backend cleanup fails verification | `cleanup_blocked`; custom definition remains until retry or explicit definition-only removal |
| Custom definition delete fails after verified cleanup | Definition remains; the now-absent backend state makes Remove safely retryable |
| Latest-cache deletion or availability broadcast fails after mutation | The committed backend/Preference mutation remains successful; derived state refreshes later |

### Availability without a definition is used in place

A tool visible through `mise`, the system PATH, or a bundled binary but carrying no custom definition is used in place — Cherry never mints a management card from mere availability, and never offers to take over or shadow an existing installation. A fixed tool is always managed from its catalog entry; a custom tool always carries a definition and so always exposes Remove. The one adoption case lives inside install: when a `node`/`python` runtime is already present at the requested version, the install adopts that observed version instead of reinstalling (the runtime rule above).

`feature.binary.install_states` is a main-owned, session-only internal Cache entry. It is not part of the shared cache schema or a renderer storage API; operations reach renderer windows only as part of snapshots. `feature.binary.latest_versions` is likewise a session cache: non-forced reads are cache-only, while a forced lookup runs `mise latest` for the applied fixed/custom recipes and writes results only if no mutation landed during the batch.

## IPC and events

The request routes and events are the IpcApi schema in `src/shared/ipc/schemas/binary.ts` — the `binaryRequestSchemas` keys (renderer→main routes) and the `BinaryEventSchemas` type (main→renderer events). Read them there rather than a hand-copied list here, which would drift. Their handlers live in `src/main/ipc/handlers/binary.ts`.

`binary.availability_changed` tells consumers to refresh their snapshots and invalidates displayed latest-version hints. The internal `isBinaryExists()` helper remains for main-process callers that only need Cherry-directory existence; it is not a renderer route.

## Custom registry collision invariant

`addCustomTool` enforces a bijection within the custom registry, checked under the mutation lock: a built-in fixed name is reserved and rejected; a given custom name maps to exactly one spec (a divergent same-name definition is rejected as "already defined with a different specification"); and a given exact tool spec maps to exactly one provider (a spec that aliases a fixed catalog recipe, or a second custom name claiming a spec already provided by another, is rejected as "already provided by `<name>`"). The same invariants gate the `normalizeCustomDefinitions` hygiene pass, so a snapshot's `definition` is never ambiguous about which name provides a spec.

## GitHub rate-limit opt-in

mise's `github:` backend hits the GitHub releases API to resolve versions. The unauthenticated limit is 60 requests per hour per IP, which is easy to exhaust behind shared NAT.

`BinaryManager.buildIsolatedEnv()` does not forward ambient `GITHUB_TOKEN` or `GH_TOKEN` values. Users can explicitly opt in through the `githubToken` field of the `feature.binary.install_settings` preference or by setting `CHERRY_GITHUB_TOKEN`; BinaryManager forwards the selected explicit value to mise as `GITHUB_TOKEN`.

```bash
export CHERRY_GITHUB_TOKEN=ghp_xxx
```

## China mirrors and advanced install settings

When the region service identifies China, BinaryManager supplies npm and pip mirror defaults to its isolated mise subprocess. An explicit user value wins over a regional default.

Settings → Dependencies → Advanced install settings persists the GitHub mirror, GitHub token, npm registry, pip index URL, and signature-verification fields together under `feature.binary.install_settings`. These values affect only the isolated install subprocess, never the execution environment of installed CLIs. Empty URL/token values retain default behavior, and signature verification defaults to enabled.

## Adding a tool

For a built-in Dependency settings preset, add an entry to `PRESETS_BINARY_TOOLS` in `src/shared/data/presets/binaryTools.ts`. Use the executable name for `name` and the canonical mise specification for `tool`; add the associated user-visible description through the normal i18n workflow.

For a Code CLI, add its executable/specification to the Code CLI preset source. `getToolSnapshots()` already includes those candidates, so no BinaryManager adapter is needed.

Fixed npm presets that require lifecycle scripts must list the exact packages in `npmAllowBuilds`. BinaryManager passes that list to mise's per-tool `allow_builds` option; packages not listed keep mise's default script blocking, and broad allow-all execution is not exposed.

To ship a bundled executable, add its platform download/checksum definition to `scripts/download-binaries.js` and its executable names/version marker to `BUNDLED_TOOLS` in `src/main/services/binaryManager/BinaryManager.ts`. Both entries are required: one supplies the artifact and the other makes extraction and snapshot availability aware of it.

`scripts/download-binaries.js` fills `resources/binaries/<platform>-<arch>/`, which is what the app extracts from at boot. During packaging (`before-pack.js` passes `--packaging`) it downloads there directly.

A dev run instead downloads into a cache shared by every worktree of the checkout, at `<git-common-dir>/cherry-binaries/<platform>-<arch>/<tool>/<version>/`, and hard-links from it into `resources/binaries/` — so a second worktree costs links rather than a repeat download, and the runtime still reads the one path it always did. The version is part of the cache path, so two worktrees on branches with different tool versions each keep their own copy instead of overwriting each other. Version markers live only in the bundle, written per worktree; the cache holds binaries alone.

Downloads stage under `.staging-<checkout-id>/` and are renamed into place only after their checksum passes, which keeps concurrent worktrees off each other's files and lets an interrupted transfer resume on the next run. Cache-internal entries (`.staging-*`, `.retired-*`) are never mirrored into a worktree, and `verifyBundledBinaries` refuses to package a bundle containing any.

The cache reclaims itself: a version whose files are hard-linked into some worktree has a link count above one, so anything left at one link and untouched for two weeks is deleted at the end of a run. The sweep covers every platform in the cache, not only the one being built, since running the script for another platform leaves a tree nothing else would visit. Deleting `<git-common-dir>/cherry-binaries/` by hand is always safe — the next run re-downloads what it needs, and `git clean` does not reach inside `.git/`.

## Consuming a tool

A service that needs to execute a CLI asks `getToolSnapshots([executableName])` and uses the current availability path. It may execute a `mise`, bundled, or system result; availability alone is sufficient for that decision. If availability is `none` and the executable is a fixed catalog tool, it calls `installByName({ name: executableName })`; main resolves the canonical recipe. An arbitrary user-supplied recipe goes through `addCustomTool(definition)`. Re-read the snapshot after installation before launching.

Do not recreate mise commands, custom registry writes, or binary search paths in a consumer. Use BinaryManager for install/remove and `application.getPath()` for main-process paths. `getBinaryPath()` and `isBinaryExists()` are narrower main-only helpers for Cherry search directories, not substitutes for snapshots when a consumer needs system-path availability.
