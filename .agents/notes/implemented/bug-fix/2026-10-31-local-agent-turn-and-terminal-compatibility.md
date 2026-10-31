# Agent Note: Local Agent turn completion and terminal compatibility

Status: implemented

English | [中文](2026-10-31-local-agent-turn-and-terminal-compatibility.zh.md)

## Problem

Claude announced completion before the SDK iterator finished returning. An immediately admitted turn could then be ended by the preceding sender. CodeBuddy supplied a whole command in ACP `terminal/create` without an argument array; treating it as one executable caused ENOENT and discarded the diagnostic. ACP internal-error envelopes also hid actionable nested details, and stale saved models reached the agent as invalid selections.

## Decision

Close the Claude iterator and query before publishing completion and releasing turn admission. Do not delay subsequent turns with a timer.

Keep terminal argument arrays literal. Only a whitespace-containing command without an argument array may use shell execution, after approval of that exact command, when neither the working-directory path nor the environment resolves the entire string to an executable. This preserves direct executable paths containing spaces. Include spawn errors in the terminal's bounded output.

Retain textual ACP error details without forwarding arbitrary response data; redact secrets and preserve the protocol error code. Add localized configuration guidance for missing models or keys. Reject a saved model absent from a non-empty catalog before requesting a model change, without silently replacing it. OpenClaw startup errors retain the diagnostic tail, prioritizing stderr over startup stdout.

On POSIX, an `EPERM` while signalling a process group waits briefly for the owned child to exit; only confirmed exit suppresses the error. A live child still reports permission failure.

## Alternatives considered

- Delay the next Claude turn: hides the race without establishing resource ownership.
- Enable a shell for every terminal request: changes literal argument semantics and quoting.
- Parse shell syntax manually: duplicates platform-specific parsing and breaks valid commands.
- Guess missing tool results or failures from agent text: fabricates protocol outcomes.

## Consequences

A whole terminal command can execute shell syntax already shown for approval; this is compatibility for command-only requests, not a change to argument-array execution. Unknown model catalogs remain unknown. Upstream agents that return successful terminal states for model failures still require an upstream fix.

## Verification

- Regression — Claude tests hold iterator cleanup open and verify that completion waits, then immediately send the next turn.
- Regression — ACP subprocess tests cover shell commands, literal metacharacters, spaced executable paths, spawn diagnostics, stale model rejection and redacted nested failures.
- Regression — OpenClaw tests place the maintenance error after startup noise and verify that it survives.
