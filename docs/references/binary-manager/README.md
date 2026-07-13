# BinaryManager Reference

`BinaryManager` is the lifecycle service that acquires and manages third-party CLI binaries through [mise](https://mise.jdx.dev). It owns the BinaryManager manifest and the filesystem/process orchestration around mise; domain services own execution, configuration, and health logic.

> **Why mise, not a custom backend interface?** mise already owns the polyglot tool grammar (`npm:`, `pipx:`, `github:`, `http:`, and its registry). A `BinaryBackend` wrapper would be a shallow abstraction that duplicates those semantics.

## Scope

BinaryManager is for a single CLI executable that mise can install (`npm:`, `pipx:`, `github:`, mise registry, and so on). It is not for multi-file server packages, hardware detection, generated configuration, or data/model downloads. Those remain with their domain service.

Examples in scope: `uv`, `bun`, `ripgrep`, `gh`, `claude-code`, and npm/pipx CLI tools. The bundled `mise` executable is internal infrastructure, not a user-facing managed tool.

## Durable ownership and runtime facts

`feature.binary.tools` is the sole durable ownership manifest. Each `BinaryManifestEntry` records the executable name, mise tool specification, and optional requested version. It means Cherry is allowed to update and remove that tool; it does **not** prove that an executable exists right now.

Only the main process writes this preference, through `BinaryManager.installTool()` and `BinaryManager.removeTool()`. The renderer sends commands and renders snapshots; it never writes manifest entries directly. There is no `state.json`, and startup never reinstalls manifest entries. A missing executable remains recoverable through the normal install path, while a manifest entry remains removable.

mise is an availability backend, not an ownership database. An executable visible to mise can be unowned; conversely, an owned manifest entry can be unavailable after external deletion. A failed manifest write after mise succeeds therefore leaves a runnable-but-unowned binary and a failed install operation, rather than silently claiming it.

Bundled copies are a separate availability source. The app extracts its shipped binaries to `cherry.bin`; that extraction does not create ownership. The runtime lookup order is mise shim, bundled binary, then the user's login-shell PATH.

## Snapshots

`getToolSnapshots(names)` is the one availability surface for renderer and main consumers. Each `BinaryToolSnapshot` combines three independent dimensions:

- `intent`: optional durable manifest ownership.
- `availability`: current `mise`, `bundled`, `system`, or `none` fact, including an executable path when available.
- `operation`: optional current install/remove state.

The returned record is intentionally a superset of the requested names. It also includes manifest entries, active operation entries, and discovered `node`/`python` runtime dependencies from mise. Predefined BinaryManager and Code CLI specifications provide candidate mappings for their requested names; they do not make unrelated tools appear in every response. This lets a newly mounted settings window render a complete management view without reconstructing ownership from availability.

A snapshot obtains live mise data with one `mise ls --json` query and reports a mise executable only after its shim passes the platform-appropriate access check. System discovery uses the raw login-shell environment so Cherry's directories and `MISE_*` settings cannot make a Cherry executable look like a system executable.

Snapshots are weakly consistent by design: they do not wait on the mutation mutex. The manifest, operation cache, mise output, and filesystem may change while a snapshot is assembled. Consumers must treat a snapshot as a display/execution decision for that moment, refresh on `binary.availability_changed`, and never derive durable ownership from `availability`.

## Mutation behavior

Install and remove mutations are serialized with the manifest and mise process operations. Per-tool active-operation guards deduplicate an identical install and reject conflicting install/remove requests before they overwrite each other's state.

Installation publishes `installing` before waiting for the global mutation lock. Under the lock it validates the intent, runs `mise use -g`, reshims, verifies that the executable is runnable, then writes the manifest. A failure leaves the manifest unchanged and publishes a failed operation with the install intent so the UI can offer recovery.

Removal publishes `removing`, removes the mise tool when present, reshims even when it was already absent, verifies removal when applicable, and only then removes the manifest entry. Failure preserves ownership and publishes a failed removal, so the UI cannot accidentally replace a removal failure with an install retry.

Runtime dependencies have one extra rule. If an existing `node` or `python` shim satisfies the requested version, installation claims it by writing a pinned manifest entry at its observed version. A version mismatch runs mise installation instead. This avoids silently replacing a usable runtime while making a durable claim explicit.

`feature.binary.install_states` is a main-owned, session-only operation cache. It is not a renderer storage API; operations reach renderer windows only as part of snapshots. `feature.binary.latest_versions` is likewise a session cache: non-forced reads are cache-only, while a forced lookup runs `mise latest` for manifest entries and writes results only if the manifest did not change during the batch.

## IPC and events

Current BinaryManager request routes are:

- `binary.install_tool`
- `binary.remove_tool`
- `binary.get_tool_snapshots`
- `binary.search_registry`
- `binary.get_latest_versions`

`binary.availability_changed` is the sole BinaryManager event. It tells consumers to refresh their snapshots and invalidates displayed latest-version hints. The internal `isBinaryExists()` helper remains for main-process callers that only need Cherry-directory existence; it is not a renderer route and does not model ownership.

## GitHub rate-limit opt-in

mise's `github:` backend hits the GitHub releases API to resolve versions. The unauthenticated limit is 60 requests per hour per IP, which is easy to exhaust behind shared NAT.

`BinaryManager.buildIsolatedEnv()` does not forward ambient `GITHUB_TOKEN` or `GH_TOKEN` values. Users can explicitly opt in through the `feature.binary.install.github_token` preference or by setting `CHERRY_GITHUB_TOKEN`; BinaryManager forwards the selected explicit value to mise as `GITHUB_TOKEN`.

```bash
export CHERRY_GITHUB_TOKEN=ghp_xxx
```

## China mirrors and advanced install settings

When the region service identifies China, BinaryManager supplies npm and pip mirror defaults to its isolated mise subprocess. An explicit user value wins over a regional default.

Settings → Dependencies → Advanced install settings persists the GitHub mirror, GitHub token, npm registry, pip index URL, and signature-verification preferences under `feature.binary.install.*`. These values affect only the isolated install subprocess, never the execution environment of installed CLIs. Empty URL/token values retain default behavior, and signature verification defaults to enabled.

## Adding a tool

For a built-in Dependency settings preset, add an entry to `PRESETS_BINARY_TOOLS` in `src/shared/data/presets/binaryTools.ts`. Use the executable name for `name` and the canonical mise specification for `tool`; add the associated user-visible description through the normal i18n workflow.

For a Code CLI, add its executable/specification to the Code CLI preset source. `getToolSnapshots()` already includes those candidates, so no BinaryManager adapter is needed.

To ship a bundled executable, add its platform download/checksum definition to `scripts/download-binaries.js` and its executable names/version marker to `BUNDLED_TOOLS` in `src/main/services/BinaryManager.ts`. Both entries are required: one supplies the artifact and the other makes extraction and snapshot availability aware of it.

## Consuming a tool

A service that needs to execute a CLI asks `getToolSnapshots([executableName])` and uses the current availability path. It may execute a `mise`, bundled, or system result; availability alone is sufficient for that decision. If availability is `none` and the service has a known canonical install specification, it calls `installTool({ intent })`; that explicit call, not an execution-source guess, declares ownership. Re-read the snapshot after installation before launching.

Do not recreate mise commands, manifest writes, or binary search paths in a consumer. Use BinaryManager for install/remove and `application.getPath()` for main-process paths. `getBinaryPath()` and `isBinaryExists()` are narrower main-only helpers for Cherry search directories, not substitutes for snapshots when a consumer needs system-path availability.
