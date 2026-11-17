# Agent Note: Allow user-defined local executables as Code CLI runtimes

Status: proposed

English | [中文](2026-11-17-custom-code-cli-executable.zh.md)

## Problem

Code CLI runtimes are a closed set. `CodeCli` in `src/shared/types/codeCli.ts` enumerates built-in tools, `CODE_CLI_TOOL_PRESETS` in `src/shared/data/presets/codeCliTools.ts` hardcodes each executable and install recipe, and `CodeCliService.requirePreset` (`src/main/services/codeCli/CodeCliService.ts:146-148`) rejects any executable outside that preset map. A user with a wrapped local runtime such as `oh-my-pi` cannot select it, and adding every wrapper as a built-in preset does not scale (issue #19966).

## Proposal

Let an Agent use a user-registered local executable as its Code CLI runtime. The registration is stored per Agent in the `configuration` JSON column of `agentTable` (`src/main/data/db/schemas/agent.ts`), with no new table and no change to built-in presets:

- `custom_cli.executable`: absolute path to the executable, validated before save.
- `custom_cli.args`: array of strings, passed to the process as an argument vector. No shell is involved, so quoting is never reparsed.

Validation runs in the main process when the Agent is saved and again before each launch. It checks that the path is absolute, is a regular file, and is executable (`X_OK` on POSIX; on Windows the extension must be one the OS can launch directly, `.exe` or `.com`). Batch wrappers (`.cmd`, `.bat`) and scripts are rejected in this version, because launching them requires `cmd.exe` parsing of arguments. Failures return a typed error code (`missing`, `not_file`, `not_executable`, `unsupported_extension`) that the renderer maps to translated, actionable messages.

Launch reuses the existing Code CLI launch path in `CodeCliService` after the built-in preset lookup, substituting the validated absolute path and the stored argument vector. The built-in `pi` path and managed installation behavior are unchanged; a custom entry never triggers mise installation.

The Agent creation and edit dialogs get a "Custom executable" option under the Code CLI runtime choice, with a path picker, an argument field and a validation status line showing the resolved absolute path. The status line shows the path and validation state only; it does not show environment variables.

## Alternatives considered

- Global custom CLI entry reusable across Agents: lets several Agents share one registration, but adds a new persisted list, its own lifecycle and a migration surface. Per-Agent storage keeps the change inside existing Agent configuration.
- Single argument string parsed with Windows-aware quoting: convenient to type, but duplicates shell quoting rules and makes `C:\Program Files\...` and `%` handling a correctness risk. A structured list avoids both.
- Accepting `.cmd` and `.bat` wrappers: many npm-installed CLIs ship only batch shims on Windows. Supporting them needs `cmd.exe` argument escaping, which this proposal does not take on; they are rejected with a `unsupported_extension` message instead.
- Automatically trusting any discovered executable on `PATH`: rejected by the issue's non-goals. Registration is an explicit user action.
- Launching the custom executable in an external terminal window: familiar to CLI users, but the Agent loses the stdout/stderr stream, exit status and session lifecycle that the Code CLI runtime drives in-process. The runtime must own the child process; a terminal takes it out of band.

## Acceptance criteria

- AC1 — Saving an Agent with a custom executable stores an absolute path and an argument array in its `configuration`; restarting Cherry Studio restores both unchanged. (verification: unit)
- AC2 — A missing, non-file, non-executable or batch-wrapper path blocks save and launch with the matching error code, and launch never spawns a process. (verification: unit)
- AC3 — Arguments containing spaces, quotes and backslashes reach the child process as the exact stored strings, including a Windows path with spaces in the executable location. (verification: unit)
- AC4 — Moving or deleting the executable after configuration makes the next launch fail with `missing` and does not fall back to any other binary. (verification: unit)
- AC5 — Built-in presets, including `pi`, keep their existing executable resolution and managed installation behavior; the existing `CodeCliService` tests pass unchanged. (verification: unit)
- AC6 — The Agent dialog shows the resolved path and validation state, uses `@cherrystudio/ui` components, and every new user-visible string is translated in `en-us.json` and synced. (verification: renderer and docs gate)

## Risks

Storing an arbitrary executable path and running it means Cherry Studio runs whatever the user registers. The explicit registration step and per-launch validation are the only guard; the proposal does not sandbox the process. Moving an executable after configuration is common on Windows (updates change install paths), so the `missing` error path must be clearly actionable to avoid users concluding the Agent is broken. Batch-wrapper rejection excludes some npm-installed CLIs; users would need to point at the underlying `.exe` if one exists.
