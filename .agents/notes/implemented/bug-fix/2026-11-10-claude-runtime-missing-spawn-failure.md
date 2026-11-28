# Agent Note: Fail fast with actionable copy when the Claude Code runtime is missing or fails to spawn

Status: implemented

English | [中文](2026-11-10-claude-runtime-missing-spawn-failure.zh.md)

## Problem

On packaged Windows builds, Agent (Work mode) turns aborted before the first model request with `ClaudeCodeProcessExitError: Claude Code process failed to start`. The main-process log showed the SDK failing to resolve its native executable (`ReferenceError: Claude Code native binary not found at ... app.asar.unpacked ... (code: ENOENT)`), or a spawn failure of an existing binary (`spawnFailed: true`). The user-facing surface was a generic unknown error: the resolved path and the `ENOENT` cause never reached the UI, and there was no in-app way to re-provision the runtime. Retries failed the same way, and a temporary extraction image path under `%TEMP%` could outlive the directory it pointed into (see #21898).

## Decision

Fail before the SDK spawns when the on-demand runtime executable is not installed, and surface renderer-owned recovery copy for both missing-runtime and spawn-failure exits:

- `ClaudeCodeBinaryService.requireExecutable()` throws `ClaudeCodeRuntimeUnavailableError` with `claude_code_runtime_missing` / `claude_code_runtime_unsupported` keys. The resolved userData path, target, version, and phase are logged in the main process; the path never crosses IPC.
- A resolved path inside `app.asar` is rejected outright so a stale or temporary application image is never used to launch the runtime.
- `ClaudeCodeProcessManager.spawn()` records the attempted executable and spawn `code` on the diagnostics; `recordClaudeCodeSpawnError` keeps the full cause in `terminalReason` (main-process only). Logs stay structured-only — `terminalReason`/stderr never enter the log line or the renderer payload.
- `createClaudeCodeProcessExitError` attaches `claude_code_spawn_failed` keys for `spawnFailed` exits; `ErrorBlock` keeps the diagnostic reference in the description and renders the antivirus/permissions check-and-resend guidance in the headline/detail (no composer Retry promise — status `ready` has no Retry control).
- `exposeAiStreamAdmission` in `src/main/ipc/handlers/ai.ts` wraps admission-time `i18nKey` errors as `AI_REQUEST_FAILED` with the full `serializeError` payload so recovery fields survive IPC; `toast.errorFromException` in `src/renderer/services/toast.ts` prefers those app-owned keys (with `claude_code_*` staying preferred even with a model provider) so the admission toast shows the localized headline and recovery detail instead of the legacy message.

## Alternatives considered

- Automatically downloading the missing executable inside the turn — rejected because acquisition already belongs to the composer-gated `ensure` flow with shared progress/retry; a turn must fail fast instead of starting a second implicit install.
- Changing only the generic SDK error text — rejected because Cherry can identify the missing unpacked artifact and the spawn `code` precisely before/at spawn time.
- Logging the raw `terminalReason`/stderr or forwarding the resolved path to the renderer — rejected because stderr and error messages can embed secrets and private paths; the existing privacy tests forbid them in logs and renderer payloads.

## Consequences

A missing runtime fails once per explicit request without spawning the SDK, so repeated turns cannot create repeated failing subprocesses. Spawn failures of an existing binary keep their diagnostic reference for log correlation while the UI names the runtime and points at an antivirus/permissions check followed by resend instead of an unknown error. The runtime path is stable userData, never the application image. Admission-time acquisition failures show the same localized recovery copy in the toast, not the legacy message.

## Verification

- Regression — `pnpm exec vitest run --project main src/main/ai/runtime/claudeCode/__tests__/claudeRuntimeUnavailable.test.ts src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeBinaryService.test.ts src/main/ai/runtime/claudeCode/__tests__/processExitDiagnostics.test.ts`: typed missing/unsupported errors, `app.asar` rejection, stable userData path, spawn `code`/executable capture without renderer leakage.
- Renderer — `pnpm exec vitest run --project renderer src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx src/renderer/utils/__tests__/errorClassifier.test.ts`: runtime-missing and spawn-failed copy render without AI diagnosis; reference preserved.
- Renderer toast — `pnpm exec vitest run --project renderer src/renderer/services/__tests__/toast.test.ts`: admission-time `AI_REQUEST_FAILED` with `claude_code_runtime_missing` shows the localized headline and recovery detail, including with a model provider present.
- Transport — `pnpm exec vitest run --project main src/main/ipc/handlers/__tests__/ai.test.ts`: admission-time runtime errors preserve `i18nKey`/`detailI18nKey` through `ai.stream.open`.
- `pnpm i18n:check`: passes.
- Packaged Windows validation was not run in this sandbox.
