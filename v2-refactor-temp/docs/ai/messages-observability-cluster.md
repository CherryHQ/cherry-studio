# Messages, Observability & Utils — Reviewer Cluster

## Scope

| Subpath | Files | Role |
|---|---|---|
| `src/main/ai/messages/` | `messageConverter.ts` (96), `fileProcessor.ts` (86) | UI `CherryMessagePart[]` → AI SDK `ModelMessage[]` |
| `src/main/ai/runtime/aiSdk/prompts/` | `deferredTools.ts` (38) | Static `<DEFERRED_TOOLS>` system-prompt section + namespace list |
| `src/main/ai/observability/adapters/aiSdk/` | `adapterTracer.ts`, `aiSdkSpanAdapter.ts` | AI SDK telemetry adapter feeding AI observability |
| `src/main/ai/utils/` | `reasoning.ts` (1092), `options.ts` (445), `modelParameters.ts` (146), `websearch.ts` (142), `provider.ts` (81), `anthropicHeaders.ts` (44), `image.ts` (5) | Shared helpers used across `runtime/aiSdk/params/features/` |
| Tests | `messages/__tests__/messageConverter.test.ts` (122), `observability/**/__tests__/`, `utils/__tests__/` | Per-file coverage |

The `messages/largeFileUpload.ts` placeholder was deleted in this pass —
its porting plan moved to [`large-file-upload-port.md`](./large-file-upload-port.md).

## Intent

These are the shared helpers `runtime/aiSdk/params/features/` rely on. They
were extracted from v1's renderer-side `prepareParams` + reasoning helpers
in `AiProvider` + per-provider `…APIClient` logic, then trimmed.

The observability cluster is small but standalone: AI SDK's
`experimental_telemetry` gives us auto-spans for free; the adapter
captures them into the dev-tools cache.

## Key changes

### `messageConverter.ts`

Folds `CherryMessagePart[]` (Cherry's renderer-facing parts) into AI
SDK's `ModelMessage[]`. Per-part routing:

- `text` → `{ role, content: [{ type: 'text', text }] }`
- `tool-*` → AI SDK tool-call / tool-result shapes
- `file` → `resolveFileUIPart` dispatch (PDF inlined as base64;
  large-file-upload path is stubbed pending the port)
- `image` → base64 inlined
- `reasoning` → `{ role, content: [{ type: 'reasoning', text }] }` (only
  emitted to providers that accept reasoning back)

### `fileProcessor.ts`

`resolveFileUIPart(part, model, provider)` returns AI SDK content
parts. Currently base64-inline only for everything; the large-file
upload path is queued as
[`large-file-upload-port.md`](./large-file-upload-port.md).

### `prompts/deferredTools.ts`

`getDeferredToolsSystemPrompt(deferredEntries)` returns the
`<DEFERRED_TOOLS>` section enumerating namespace lines for each entry's
namespace; used by `assembleSystemPrompt` (params cluster) when
`tool_search` is in the final tool set.

### `observability/adapters/aiSdk/adapterTracer.ts`

Wraps an OTel tracer. On every span start, patches `span.end()` to also
convert via `AiSdkSpanAdapter.convertToSpanEntity(...)` and persist via
`SpanCacheService.saveEntity(...)`. Used by `buildTelemetry` (passed
to AI SDK) and by chat-context providers (root span).

### `observability/adapters/ai-sdk/aiSdkSpanAdapter.ts`

656-line file that knows AI SDK's hierarchical attribute conventions
(`ai.xxx` is a level, `ai.xxx.yyy` is a sub-level). Normalises usage
attributes (`ai.usage.input_tokens` etc.) across providers.

### `utils/reasoning.ts`

Per-vendor reasoning parameter assembly:
`getOpenAIReasoningParams`, Anthropic adaptive thinking parameter shape
(Claude 4.6 vs Claude 3.x distinction), DeepSeek `<think>` parser,
Doubao / Hunyuan thinking tokens. Massive file because every vendor has
different shape for the same concept; folding them into one helper keeps
the per-feature plugin code small.

### `utils/options.ts`

`buildCapabilityProviderOptions`, `extractAiSdkStandardParams`,
`mergeCustomProviderParameters` — the customParameters split path
described in [params-cluster.md](./params-cluster.md). Commit
`91aa8d4ad chore(ai-options): trim PR-description comments inflating
v1→v2 port diff` was a comment cleanup in this file.

### `utils/websearch.ts`

`buildProviderBuiltinWebSearchConfig` — builds the per-provider config
hash that `providerToolPlugin('webSearch', config)` consumes. Replaces
v1's `checkWebSearchAvailability` (commit `792621991 refactor(web-search):
inline sole-use checkWebSearchAvailability, delete dead module`).

## Invariants

- `messageConverter.convertParts` is pure — no DB reads, no IPC.
- `aiSdkSpanAdapter.convertToSpanEntity` must not throw — caller catches
  but logs; persistence is best-effort and never fails the LLM call.
- `reasoning.ts` per-vendor branches are gated on `model.id` /
  `provider.id` — never on `apiHost`.

## Validation

- `messages/__tests__/messageConverter.test.ts` (122)
- `utils/__tests__/options.test.ts` (141)
- `utils/__tests__/modelParameters.test.ts` (111)
- `utils/__tests__/provider.test.ts` (102)
- `utils/__tests__/anthropicHeaders.test.ts` (59)

## Follow-ups (out of scope)

- See [large-file-upload-port.md](./large-file-upload-port.md).
- `reasoning.ts` has a `FIXME: duplicated openrouter handling — remove
  one` annotation that should land in a follow-up.
