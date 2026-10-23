# Agent Note: Preserve Ollama native thinking levels

Status: implemented

English | [中文](2026-10-23-ollama-native-thinking-levels.zh.md)

## Problem

Ollama declares model-specific thinking controls through `/api/show`, but discovery reads only the context window. Registry enrichment and model creation lose native controls, while the patched SDK rejects `xhigh`. Qwen3.8 27B supports `false`, `low`, `medium`, and `xhigh`; generic `high` is not an equivalent setting.

## Decision

Discovery converts supported native values into intrinsic reasoning controls. Model creation and update retain these controls in the existing reasoning JSON column. Native Ollama reads prefer stored controls over catalog inference, including explicit empty controls for models that declare only `false`. Other endpoint formats retain their existing registry precedence.

The Ollama preset defaults to `ollama-chat`. An explicitly native model uses that endpoint for reasoning projection even when its provider selects another default.

The model-fetch action updates existing rows through the batch model API, changing only reasoning metadata and its capability flag. Missing metadata does not clear saved controls. Native metadata remains stored even when it currently matches the catalog. The SDK patch accepts boolean or string `think` values; the application's closed reasoning vocabulary determines which named levels are selectable.

## Alternatives considered

- Hard-code Qwen model names: aliases and quantized tags still depend on catalog matching.
- Substitute `high` for `xhigh`: Ollama may silently use the model default instead.
- Remove and recreate models: existing model identity and user settings need not change.

## Consequences

Users fetch Ollama models to refresh existing thinking choices. No database migration or new settings control is needed. Unknown named levels are not exposed. Provider wire profiles remain outside persisted model data.

## Verification

- Regression — `listModels.test.ts`: native metadata supplies exact choices even without tag capabilities; boolean-only, disabled, and unknown-level declarations are covered.
- Regression — `ModelService.test.ts`: custom, recognized, and preset rows retain native controls on reads and updates while preserving other user settings.
- Regression — `modelSync.test.ts` and `useProviderModelPullReconcile.test.ts`: catalog enrichment and creation preserve native choices; missing metadata and unchanged projections do not overwrite saved configuration.
- Regression — `ollama.chatReasoning.test.ts`: streamed and non-streamed SDK requests emit `false`, `low`, `medium`, and `xhigh` unchanged, while default omits `think`.
- Regression — Electron with Ollama 0.34.3 and `qwen3.8:27b`: fetching refreshes saved controls while retaining a custom context window; UI selections emit each native value and omit the default; disabled thinking completes a real `OK` reply. Other selections are cancelled after request capture. The controls and custom context window survive an application restart.
