# Agent Note: Expose native PowerShell tools on Windows

Status: implemented

English | [中文](2026-11-10-pi-windows-powershell.zh.md)

## Problem

Cherry registered only Bash for Pi and Pi Durable, leaving Windows agents without command execution when no Bash installation was available. Both pinned SDKs already provide a native PowerShell tool, but registering it alone bypasses protections that previously recognized only `bash`.

## Decision

Register native `powershell` only on Windows. Reuse each SDK's executable discovery and fallback: Pi locates `pwsh.exe` before Windows PowerShell, while Durable tries `pwsh` then `powershell` only after a spawn failure. Keep the tool's native identity for configuration, history and approvals.

Share `mergePiShellExecutionEnv` with Bash. It merges environment variables and binary search paths, preserves PowerShell-specific variables and caller-owned mise configuration, and adds no shell syntax. The Bash login-PATH prefix and RTK rewrite remain Bash-only.

Apply the existing disabled-tool, global-install and user-data SQLite rules to PowerShell. Auto mode asks for approval for recognized destructive commands, including PowerShell deletion and truncation commands. This heuristic is not a complete PowerShell parser or a sandbox.

## Alternatives considered

- Requiring Git Bash preserves the Windows compatibility gap.
- Passing Bash source to PowerShell changes command semantics and can repeat side effects after failure.
- A custom PowerShell launcher duplicates native executable discovery, output handling and cancellation.

## Consequences

Windows agents can use PowerShell without Bash. Other platforms do not advertise it, while historical tool rendering retains its identity. Existing explicit Bash `shellPath` validation remains unchanged. This fix adds no background execution or interactive stdin channel.

## Verification

- Regression — `src/shared/ai/__tests__/agentRuntimeCapabilities.test.ts`: Windows-only catalog entries and disabled-name normalization.
- Regression — `src/main/ai/runtime/pi/piApprovalFacts.test.ts`: destructive-command approval, protected SQLite, global-install blocking and unchanged PowerShell arguments.
- Regression — `src/main/ai/runtime/pi/piShell.test.ts`: PowerShell environment preservation, Windows PATH casing and caller-owned mise state.
- Regression — `src/main/ai/runtime/pi/PiRuntimeConnection.test.ts` and `src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts`: model-facing tool exposure and disabled tools. Native Unicode file execution runs only on Windows and is skipped on macOS.
