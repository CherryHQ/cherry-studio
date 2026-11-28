# Agent Note: Repair truncated managed DeepSeek Harness installs missing dsh-scope

Status: implemented

English | [中文](2026-11-27-dsh-scope-repair.zh.md)

## Problem

Managed `@deepseek-ai/dsh@0.1.1-rc.2` exits before readiness with `ERR_MODULE_NOT_FOUND` for `@deepseek-ai/dsh-scope` imported by `@deepseek-ai/dsh-agent-loop`. `dsh-scope` is only a transitive peer, so npm can report success without it. The DSH graph resolves about 455 packages and needs roughly 12 minutes for resolution alone, so the shared 15-minute install budget truncates downloads on Windows with antivirus on a cold cache. A plain `mise use -g` then no-ops on the already-active version and leaves the peer missing. Startup spawned the broken binary and surfaced only `exited before it was ready (code 1)` with no failed-package name or repair action.

## Decision

The DSH preset carries `installTimeoutMs: 30 * 60_000`, threaded through `installWithMise` and `installPipxTool` via `MISE_INSTALL_TIMEOUT_OVERRIDES` and `FIXED_CATALOG`. `runMise` with `shellOutNpm` sets `NPM_CONFIG_LEGACY_PEER_DEPS=false` plus `FUND/AUDIT=false`; the isolated `HOME` already blocks user `.npmrc`. The required-peer probe resolves the host from the package's own JavaScript entry with a Windows npm-prefix fallback: when `createRequire` from the launcher cannot see a nested host (launcher at the install prefix, `dsh-agent-loop` under the top package's own `node_modules`), it retries from `<install>/node_modules/<pkg>/package.json` (plus `lib/` and launcher-parent variants) before concluding the tree is healthy. A broken required-peer install with a verified peer loss forces a scoped clean reinstall (Node is provisioned first, then `unuse -g` best-effort, `uninstall <tool>@<broken-version>` with `--all` only as fallback, `reshim`, fresh `use`) so Retry repairs the tree instead of no-oping. A missing shim alone keeps its tree and reports a generic runnable failure. The post-install gate names the missing peer only when the peer loss is verified. `DeepSeekHarnessService.findBinary` fails fast only for the managed (`mise`) copy on `broken`/`unknown`/`conflict` with an actionable message naming `dsh-scope` and pointing to Code → DeepSeek Harness → Retry, without spawning the child; a working `system` copy is preserved, and a verified `broken` with `source: 'none'` still surfaces the repair action.

## Alternatives considered

- Raising the global 15-minute timeout for every tool slows every install-failure signal for unrelated tools.
- Retrying with plain `mise use -g` without wiping the recipe no-ops when the same version is already active.
- Silently auto-reinstalling on startup without user consent hides the failure and races Dependencies operations.
- Relying only on user `.npmrc` hygiene is insufficient because the isolated install `HOME` already blocks it, while future mise config forwarding could reintroduce legacy peer semantics.

## Consequences

DSH installs may hold the install lock for up to 30 minutes; other tools keep the 15-minute budget. Retry of a verified broken DSH wipes only the affected version after Node is provisioned, so a Node failure cannot delete versions the base path kept; shim-only failures keep the tree and stay retryable through a normal `use`. The operation is not safe to run concurrently with another DSH mutation (the existing mutation mutex already serializes this). A broken managed DSH blocks launch with repair guidance instead of spawning and reporting only exit code 1, while a working system DSH still launches. System-source DSH copies bypass the peer gate because they carry no managed application fact.

## Verification

- Regression — `src/main/services/binaryManager/__tests__/BinaryManager.test.ts`: DSH uses the 30-minute timeout, shell-out sets legacy-peer-deps false, verified broken triggers version-scoped uninstall plus use with Node provisioned before wipe, Windows prefix layout is detected via the package entry and repaired through the same path, shim-only failure keeps the tree and throws generic not-runnable, and a still-incomplete tree throws the missing-peer message.
- Regression — `src/main/services/deepSeekHarness/__tests__/DeepSeekHarnessService.test.ts`: managed broken snapshot fails fast with dsh-scope plus Retry and no spawn; managed unknown fails fast without spawn; system broken and system unknown preserve the system path and launch; broken with no fallback still surfaces the Code → DeepSeek Harness → Retry repair.
- Regression — `src/shared/data/presets/__tests__/codeCliTools.test.ts`: preset shape and catalog identity remain valid.
