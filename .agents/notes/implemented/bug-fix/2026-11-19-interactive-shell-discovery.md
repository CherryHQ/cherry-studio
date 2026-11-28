# Agent Note: Interactive shell fallback for system tool discovery

Status: implemented

English | [中文](2026-11-19-interactive-shell-discovery.zh.md)

## Problem

A non-interactive login shell does not read `.zshrc`. Tools installed under fnm can therefore work in a terminal but appear absent in system tool snapshots. Resolving their absolute paths alone is insufficient: Node launchers still need the runtime environment.

## Decision

Keep non-interactive discovery first. On a POSIX system lookup miss, capture the interactive login shell with the existing 15-second timeout and delimit its environment output from startup banners. Share the pending capture, success, or failure until explicit environment refresh. Append only new PATH directories after existing ones and publish that PATH to both detection and execution. Do not import interactive HOME, proxy, credentials, or runtime-manager variables into the shared environment. Retry only missing tools, preserving already-resolved paths. Local-agent launch rereads it after dependency discovery.

A failed interactive capture keeps verified system results and runnable managed/bundled alternatives. If any missing tool has no verified alternative, reject the batch query rather than claiming that an unverified tool is absent. The original cached environment remains usable for lookups that succeed without fallback. A refresh invalidates the interactive capture; late completion cannot overwrite the newer cache.

## Alternatives considered

- Always use an interactive shell: executes prompt plugins even when unnecessary.
- Hardcode fnm or Codex paths: misses other runtime managers and separates discovery from execution.
- Replace PATH with the interactive PATH: can silently replace an already-discovered executable.
- Return partial results after startup failure: the current availability protocol has no per-tool unknown state and would mislabel failures as absence.

## Consequences

The first missing-tool query can run user interactive startup scripts and wait up to 15 seconds. Failures remain cached until refresh. A mixed batch can fail even when some tools were found; adding per-tool unknown availability is a separate protocol/UI change. Existing PATH precedence wins over an interactive runtime version; explicit configuration remains available when another runtime is required. Windows registry discovery is unchanged.

## Verification

- Regression — `shellEnv.interactive.test.ts`: PATH-only capture, unchanged non-PATH variables, environment copies, startup banners, bounded timeout, failure caching, and refresh races.
- Regression — `BinaryManager.test.ts` and `launch.test.ts`: interactive-only discovery, preservation of existing tool selection, honest failure, and launch environment consistency.
- Regression — live Electron on macOS cold-launched without an interactive parent shell and with restricted parent PATH; an explicit refresh establishes the baseline without mutating process.env: baseline misses Codex/Kimi/Qwen/Pi/Grok, production discovery finds all five, their actual version commands succeed, Codex launch uses the discovery PATH, and non-PATH environment values remain unchanged.
