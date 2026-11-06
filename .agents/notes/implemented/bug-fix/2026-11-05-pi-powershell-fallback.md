# Agent Note: Windows Pi sessions fall back to PowerShell when no Git Bash is discoverable

Status: implemented

English | [中文](2026-11-05-pi-powershell-fallback.zh.md)

## Problem

Windows work-mode turns failed or silently ran inside WSL on hosts without Git for Windows. Cherry bundles MinGit (`scripts/download-binaries.js`), which is a `git`-only distribution and ships no `bash.exe`. pi's shell resolution (`findGitBash` / `autoDiscoverGitBash` in `src/main/utils/commandResolver.ts`) only considers `CLAUDE_CODE_GIT_BASH_PATH`, `bash.exe` derived from a system `git.exe` (found on PATH or under `Program Files`, `Program Files (x86)` and `%LOCALAPPDATA%\Programs`), and `%ProgramFiles%\Git\bin\bash.exe`; the bundled tree is appended to spawned-process PATH only, so discovery never sees it. With nothing discovered, pi fell through to `bash.exe` on PATH — normally `C:\Windows\System32\bash.exe`, the WSL shim — and the turn ran in the wrong environment or failed with "No bash shell found".

## Decision

`resolvePiShellSelection()` in `src/main/ai/runtime/pi/piShell.ts` is the single decision point. Non-Windows hosts, a valid explicit `shellPath`, and any Git Bash found by discovery keep the `bash` tool and its resolved path. On Windows only, when discovery finds nothing, the session exposes pi's native `powershell` tool instead: no managed bash tool is mounted and neither `shellPath` nor `shellCommandPrefix` is set, which is what keeps pi away from the WSL shim. Both Pi runtimes consume the same selection (`PiRuntimeConnection`, and `piDurable/durableDesktop`, which installs `tools.createPowerShellTool()`), and `listAvailableTools` reports only the tool that host will expose.

Approval parity ships with it: the shared facts path reads `command` for `bash` and `powershell`, `detectDestructiveCommand` and `detectGlobalInstall` gained a PowerShell dialect, and the bash-only `rtkRewrite` never runs on a PowerShell command. An explicitly configured `shellPath` that is missing or is not `bash.exe` still fails startup with the same error as before — the fallback must not swallow it, because silently switching execution environments was rejected in #20322 and #20304.

## Alternatives considered

- Bundling a full Git Bash or PortableGit for Windows would guarantee a shell but adds a GPLv3 distribution obligation and a large installer; the maintainer rejected it for this fix.
- Adding a lone `bash.exe` into the MinGit tree carries the same licensing question with a much weaker guarantee that the resulting shell environment is complete and tested.
- Falling back to discovery, or to any `bash.exe` found on PATH, reproduces the silent WSL switch that #20304 reported.
- Honouring `defaultTools` from the user's `~/.pi/agent/settings.json` would let users pick PowerShell themselves, but Cherry owns that list through an in-memory settings manager; settings files are not a supported surface here.
- Making the edit-dialog tool catalog platform-aware needs a new renderer→main IPC channel, which this change deliberately does not introduce.

## Consequences

On a Windows host without Git for Windows, work-mode turns now run in Windows PowerShell (PowerShell 7 is preferred when available) instead of WSL or an error. The agent edit dialog keeps a single shell switch because the capability is shared: disabling either shell name disables both, and which one runs is decided in the main process rather than shown in the dialog. Prompts and skills that assume bash semantics need a PowerShell equivalent on those hosts. Hosts with Git Bash are unaffected.

## Verification

- Regression — base implementations reverted: 36 failed / 197 passed across `piShellSelection.test.ts`, `piApprovalFacts.test.ts`, `destructiveCommand.test.ts`, `dependencyGuard.test.ts`; the restored change passes the same files.
- Regression — `vitest --project main`: `piShellSelection`, `piApprovalFacts`, `PiRuntimeDriver`, `PiDurableRuntimeConnection`, `PiRuntimeConnection`, `PiRuntimeConnection.sdkContract`, `destructiveCommand`, `dependencyGuard`, `userDataSqliteGuard` — 0 failed.
- Regression — `vitest packages/agent-behavior/tests/core/approval/approval.test.ts`: destructive PowerShell in `auto` mode requires approval; benign PowerShell commands do not — 0 failed.
- Regression — `vitest --project renderer`: `toolResponse.test.ts` — 0 failed.
- Regression — `tsc --noEmit` for `tsconfig.node.json` and `tsconfig.web.json` — exit 0.
- Regression — ESLint, Oxlint `--deny-warnings`, Oxfmt `--check` on the changed files — exit 0; `scripts/i18n-check.ts` — 98,786 translations.
- Not verified — no Windows host executed PowerShell live; the fallback is exercised through the injected selection and the mocked durable runtime.
