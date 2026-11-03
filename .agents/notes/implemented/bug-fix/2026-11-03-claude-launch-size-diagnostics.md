# Agent Note: Claude Code launch-size diagnostics

Status: implemented

English | [中文](2026-11-03-claude-launch-size-diagnostics.zh.md)

## Problem

A synchronous Claude Code spawn failure with `ENAMETOOLONG` or `E2BIG` was recorded using only `error.message` and classified as `unknown`. On the cold path the raw error reached the renderer, so a Windows user whose launch exceeds an OS limit saw an unknown error without actionable guidance. The repair spans `src/main/ai/runtime/claudeCode/ClaudeCodeProcessManager.ts`, `processExitDiagnostics.ts`, and the new `claudeCodeLaunchSize.ts`; `src/shared/utils/errorCategory.ts`, `src/shared/ai/executionFailure.ts`, `src/renderer/utils/errorToast.ts`, and the renderer locale catalogs handle classification and presentation.

## Decision

At the spawn seam, only size-family failures record safe launch measurements: argv count and UTF-16/UTF-8 totals, command lengths in both encodings, environment entry count, block size and string bytes, cwd lengths and whether it is inherited, and the three largest arguments with a coarse allowlisted owner. The retained `terminalReason`, structured warning log, and in-memory diagnostics carry these facts; the surfaced error never carries them or launch inputs.

The shared `launch_size` category presents a warning without an action, with translated diagnosis text in all 15 renderer catalogs, and projects to the existing remote reason `invalid_input`. A synchronous size-family failure is rethrown as the existing safe `ClaudeCodeProcessExitError`: the cold path calls SDK `query()` in `ClaudeCodeRuntimeDriver.ts:373` before `runQueryLoop()` at `:405`, so the wrapping catch at `:717-726` cannot see a construction failure. Launch inputs are never modified.

## Alternatives considered

- Reuse `payload`, `context_length`, or `bad_request`: these describe HTTP or history problems and would mislead users.
- Enrich only the message while retaining `unknown`: this fails the dispatch acceptance and does not survive the safe wrapper.
- Implement a full SDK argv grammar for ownership: over-engineered for the evidence needed.
- Decorate the original error: this introduces a second projection pattern instead of reusing the safe projection.
- Add a remote-protocol reason code: the enum is closed and existing `invalid_input` covers this case.

## Consequences

Size-family failures change error identity and message to the safe projection and carry a diagnostic reference. The measurements are input-size proxies, not platform-limit calculations: Windows quoting and terminator expansion and native-added environment are invisible, while POSIX pointer tables and kernel overhead are not counted. Non-size synchronous failures keep their exact error object, message, and classification. Nothing is trimmed, moved, or blocked. The actual oversized field for the reported Windows user remains unconfirmed; reducing it is follow-up work.

## Verification

- Regression — the old-head prefix probe reported `unknown` instead of `launch_size` and `launchSize` absent; its assertion was RED. The prior manager test also failed on the missing safe category and reference before the change.
- Regression — the main Vitest files `ClaudeCodeProcessManager`, `claudeCodeLaunchSize`, `processExitDiagnostics`, and `ClaudeCodeRuntimeDriver` passed 137 tests; renderer files `errorClassifier`, `toast`, and `doctorContent` passed 136; shared files `executionFailure` and `errorCategory` passed 103.
- Regression — node and web TypeScript checks, `i18n-check` (97,346 translations), changed-file Oxlint, ESLint and Oxfmt checks passed. Agent Note format, pairing, structure, frontmatter, links, terminology and index documentation gates passed; the earlier documentation gates ran before this triplet existed.
- Regression — no Windows reproduction or Electron end-to-end run was performed in this phase.
