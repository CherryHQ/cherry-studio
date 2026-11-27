# Agent Note: Repair truncated managed DeepSeek Harness installs missing dsh-scope

Status: implemented

English | [中文](2026-11-27-dsh-scope-repair.zh.md)

## Problem

Managed `@deepseek-ai/dsh@0.1.1-rc.2` exits before readiness with `ERR_MODULE_NOT_FOUND` for `@deepseek-ai/dsh-scope` imported by `@deepseek-ai/dsh-agent-loop`. `dsh-scope` is only a transitive peer, so npm can report success without it. The DSH graph resolves about 455 packages and needs roughly 12 minutes for resolution alone, so the shared 15-minute install budget truncates downloads on Windows with antivirus on a cold cache. A plain `mise use -g` then no-ops on the already-active version and leaves the peer missing. Startup spawned the broken binary and surfaced only `exited before it was ready (code 1)` with no failed-package name or repair action.

## Decision

The DSH preset carries `installTimeoutMs: 30 * 60_000`, threaded through `installWithMise` and `installPipxTool` via `MISE_INSTALL_TIMEOUT_OVERRIDES` and `FIXED_CATALOG`. `runMise` with `shellOutNpm` sets `NPM_CONFIG_LEGACY_PEER_DEPS=false` plus `FUND/AUDIT=false`; the isolated `HOME` already blocks user `.npmrc`. A broken required-peer install forces a clean reinstall (`unuse -g` best-effort, then `uninstall --all`, `reshim`, fresh `use`) so Retry repairs the tree instead of no-oping. The post-install gate names the missing peer when the tree is still incomplete. `DeepSeekHarnessService.findBinary` fails fast on `broken`/`unknown`/`conflict` with an actionable message naming `dsh-scope` and pointing to Dependencies → Retry, without spawning the child.

## Alternatives considered

- Raising the global 15-minute timeout for every tool slows every install-failure signal for unrelated tools.
- Retrying with plain `mise use -g` without wiping the recipe no-ops when the same version is already active.
- Silently auto-reinstalling on startup without user consent hides the failure and races Dependencies operations.
- Relying only on user `.npmrc` hygiene is insufficient because the isolated install `HOME` already blocks it, while future mise config forwarding could reintroduce legacy peer semantics.

## Consequences

DSH installs may hold the install lock for up to 30 minutes; other tools keep the 15-minute budget. Retry of a broken DSH wipes its recipe before reinstalling, so the operation is not safe to run concurrently with another DSH mutation (the existing mutation mutex already serializes this). A broken managed DSH blocks launch with repair guidance instead of spawning and reporting only exit code 1. System-source DSH copies bypass the peer gate because they carry no managed application fact.

## Verification

- Regression — `src/main/services/binaryManager/__tests__/BinaryManager.test.ts`: DSH uses the 30-minute timeout, shell-out sets legacy-peer-deps false, broken triggers uninstall plus use, and a still-incomplete tree throws the missing-peer message.
- Regression — `src/main/services/deepSeekHarness/__tests__/DeepSeekHarnessService.test.ts`: broken snapshot fails fast with dsh-scope plus Retry and no spawn; unknown state fails fast without spawn.
- Regression — `src/shared/data/presets/__tests__/codeCliTools.test.ts`: preset shape and catalog identity remain valid.
