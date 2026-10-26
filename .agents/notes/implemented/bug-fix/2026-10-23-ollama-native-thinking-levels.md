# Agent Note: Preserve Ollama native thinking levels

Status: implemented

English | [中文](2026-10-23-ollama-native-thinking-levels.zh.md)

## Problem

Ollama declares model-specific thinking controls through `/api/show`, but discovery reads only the context window. Registry enrichment and model creation lose native controls, while the patched SDK rejects `xhigh`. Qwen3.8 27B supports `false`, `low`, `medium`, and `xhigh`; generic `high` is not an equivalent setting.

## Decision

Discovery converts supported native values into intrinsic reasoning controls. Model creation and update retain these controls in the existing reasoning JSON column. Native Ollama model reads and request-time resolution prefer stored controls over catalog inference, including explicit empty controls for models that declare only `false`. Request-time resolution retains the registry wire profile. Other endpoint formats retain their existing registry precedence.

The Ollama preset defaults to `ollama-chat`. A model's first saved endpoint takes precedence over provider and catalog defaults when projecting reasoning and request controls. Native levels remain stored when a non-native endpoint is selected, but the active endpoint determines which choices are exposed. Switching back to a native endpoint restores its native levels.

For Ollama presets and copies without an explicit default or native host, a saved Anthropic-slot host also supplies the native connection host. Reads leave the stored row unchanged. An explicit native host reset remains stored even when it matches the factory URL, so the old host cannot override that choice again.

The Claude Agent SDK can inject `high` even when thinking is disabled or unspecified. Native Ollama Agent routes carry the submitted canonical selection through an internal header. The gateway accepts it only for authenticated internal Agent requests and uses the normal reasoning serializer instead of SDK-derived thinking options. External requests and invalid header values retain their existing behavior.

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
- Regression — `ollamaReasoning.integration.test.ts`: discovery, persistence, and request construction preserve Nemotron's native `medium` despite catalog toggle controls; streamed and non-streamed SDK bodies send `false`, `true`, and `medium`, while default omits `think`. A saved Anthropic-first endpoint exposes catalog toggle choices; switching back to Ollama-first restores native `medium` and sends it unchanged.
- Regression — `ProviderService.readMerge.test.ts` and `ollamaReasoning.integration.test.ts`: old remote hosts survive the native-default transition for presets and copies through discovery and SDK requests; explicit native hosts/defaults, custom providers, and a later reset to localhost keep their ownership.
- Regression — `agentSessionWarmup.test.ts` and `proxyStream.stream.test.ts`: submitted off/default/medium selections survive the Claude SDK gateway in streaming and non-streaming calls; untrusted and invalid header values cannot override request options. An installed SDK HTTP probe reproduced injected `high` for disabled/default thinking before the bridge correction; capture stopped before generation.
- Regression — Electron with Ollama 0.34.3 and `qwen3.8:27b`: fetching refreshes saved controls while retaining a custom context window; UI selections emit each native value and omit the default; disabled thinking completes a real `OK` reply. Other selections are cancelled after request capture. The controls and custom context window survive an application restart.
