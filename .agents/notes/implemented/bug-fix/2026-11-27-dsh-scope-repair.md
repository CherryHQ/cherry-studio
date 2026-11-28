# Agent Note: Repair truncated managed DeepSeek Harness installs missing dsh-scope

Status: implemented

English | [中文](2026-11-27-dsh-scope-repair.zh.md)

## Problem

Managed `@deepseek-ai/dsh@0.1.1-rc.2` exits before readiness with `ERR_MODULE_NOT_FOUND` for `@deepseek-ai/dsh-scope` imported by `@deepseek-ai/dsh-agent-loop`. `dsh-scope` is only a transitive peer, so npm can report success without it. The DSH graph resolves about 455 packages and needs roughly 12 minutes for resolution alone, so the shared 15-minute install budget truncates downloads on Windows with antivirus on a cold cache. A plain `mise use -g` then no-ops on the already-active version and leaves the peer missing. Startup spawned the broken binary and surfaced only `exited before it was ready (code 1)` with no failed-package name or repair action.

## Decision

The DSH preset carries `installTimeoutMs: 30 * 60_000`, threaded through `installWithMise` and `installPipxTool` via `MISE_INSTALL_TIMEOUT_OVERRIDES` and `FIXED_CATALOG`. `runMise` with `shellOutNpm` sets `NPM_CONFIG_LEGACY_PEER_DEPS=false` plus `FUND/AUDIT=false`; the isolated `HOME` already blocks user `.npmrc`. The required-peer probe is filesystem-based so it observes same-process reinstalls: `createRequire` caches misses (observed on Node 24.22.2) and would keep reporting failure after the peer is restored, so `hasRequiredRuntimeDependencies` walks `node_modules` with `fs.existsSync` from the launcher and from the top package entry (`resolvePackageDirViaFilesystem` plus `resolvePackageDirFromTop` covering `<install>/node_modules/<pkg>`, `lib/` variants, and launcher-parent bases) before concluding the tree is healthy. A broken required-peer install with a verified peer loss forces a scoped clean reinstall (Node is provisioned first, then `unuse -g --no-prune` best-effort so an unreferenced cached version survives, `uninstall <tool>@<broken-version>` with `--all` only as fallback, `reshim`, fresh `use`) so Retry repairs the tree instead of no-oping. A missing shim alone keeps its tree and reports a generic runnable failure. The post-install gate names the missing peer only when the peer loss is verified. `BinaryManager.isToolPeerMissing` exposes that verification to launchers; `DeepSeekHarnessService.findBinary` fails fast only for the managed (`mise`) copy on `broken`/`unknown`/`conflict` without spawning the child, naming `dsh-scope` only when the peer loss is verified and otherwise reporting a generic runnable failure with the same Code → DeepSeek Harness → Retry guidance. A working `system` copy is preserved, and a verified `broken` with `source: 'none'` still surfaces the repair action.

## Alternatives considered

- Raising the global 15-minute timeout for every tool slows every install-failure signal for unrelated tools.
- Retrying with plain `mise use -g` without wiping the recipe no-ops when the same version is already active.
- Silently auto-reinstalling on startup without user consent hides the failure and races Dependencies operations.
- Relying only on user `.npmrc` hygiene is insufficient because the isolated install `HOME` already blocks it, while future mise config forwarding could reintroduce legacy peer semantics.

## Consequences

DSH installs may hold the install lock for up to 30 minutes; other tools keep the 15-minute budget. Retry of a verified broken DSH wipes only the affected version after Node is provisioned, with `unuse -g --no-prune` so a failed download cannot delete an unreferenced cached version and a Node failure cannot delete versions the base path kept; shim-only failures keep the tree and stay retryable through a normal `use`. The operation is not safe to run concurrently with another DSH mutation (the existing mutation mutex already serializes this). A broken managed DSH blocks launch with repair guidance instead of spawning and reporting only exit code 1, naming `dsh-scope` only on verified peer loss and otherwise reporting a generic runnable failure with the same Retry guidance, while a working system DSH still launches. System-source DSH copies bypass the peer gate because they carry no managed application fact.

## Verification

- Regression — `src/main/services/binaryManager/__tests__/BinaryManager.test.ts`: DSH uses the 30-minute timeout, shell-out sets legacy-peer-deps false, verified broken triggers version-scoped uninstall plus use with Node provisioned before wipe and `unuse` carrying `--no-prune`, Windows prefix layout is detected via the filesystem top-package walk and repaired through the same path, same-version reinstall flips the filesystem probe from false to true within one process via real package files, a failed reinstall keeps the `--no-prune` sequence and stays version-scoped, shim-only failure keeps the tree and throws generic not-runnable, and a still-incomplete tree throws the missing-peer message.
- Regression — `src/main/services/deepSeekHarness/__tests__/DeepSeekHarnessService.test.ts`: managed broken snapshot with verified peer fails fast with dsh-scope plus Retry and no spawn; managed unknown fails fast without spawn; system broken and system unknown preserve the system path and launch; broken with no fallback and verified peer still surfaces the Code → DeepSeek Harness → Retry repair; shim-only and peer-present broken snapshots report the generic runnable failure with Retry and never name dsh-scope.
- Regression — `src/shared/data/presets/__tests__/codeCliTools.test.ts`: preset shape and catalog identity remain valid.
