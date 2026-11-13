# Agent Note: Preserve Codex context settings during provider rebuilds

Status: implemented

English | [中文](2026-11-09-codex-context-window.zh.md)

## Problem

Codex provider rebuilds removed `model_context_window` and `model_auto_compact_token_limit` without restoring them or using the selected model's capacity. Config-only edits lost both settings too (Issue #24006).

## Decision

A provider rebuild uses the selected model's positive safe-integer `contextWindow` when available, otherwise preserving a valid existing window. It independently preserves a valid existing compaction limit. Invalid values are omitted. Config-only edits use the existing values. Clear and own-login remove both keys; direct-provider supplied drafts are submitted verbatim, while gateway drafts are rebuilt.

## Alternatives considered

- Always remove existing limits when metadata is unavailable: loses manual settings.
- Remove the keys from managed ownership: prevents Clear and own-login from removing generated context settings.
- Derive a compaction limit from the window: introduces an unsupported policy.

## Consequences

A valid existing window survives a switch to a model with unknown capacity, even if it was generated for an earlier model. The file cannot distinguish generated and hand-written values; no provenance is tracked. No relationship between the two limits is imposed.

## Verification

- Regression — `src/renderer/pages/code/cliConfig/__tests__/builders.test.ts`: checks precedence, independent preservation, invalid values, and lossless safe-integer serialization.
- Regression — `src/renderer/pages/code/cliConfig/__tests__/writeCliConfigDraft.test.ts`: checks direct and gateway writes, unavailable metadata, and supplied-file behavior.
- Regression — `src/renderer/pages/code/cliConfig/__tests__/draftUpdater.test.ts`: checks config-only edits preserve both limits and connection.
- Regression — `src/renderer/pages/code/cliConfig/__tests__/clear.test.ts`: checks Clear removes both limits and retains unrelated settings.
- Regression — `src/renderer/pages/code/cliConfig/__tests__/ownLogin.test.ts`: checks own-login removes both limits and retains unrelated settings.
