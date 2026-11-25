---
description: Supported generation protocol conversions, adapter-specific controls, unsupported requests, and verification limits
sources:
  - src/main/features/apiGateway/adapters
  - src/main/features/apiGateway/prepareGatewayMessage.ts
  - src/main/features/apiGateway/errors.ts
---

# Generation Protocol Compatibility

English | [中文](protocol-compatibility.zh.md)

The [API Gateway](README.md) converts requests through one Cherry provider and one
AI SDK execution. HTTP and native object calls use the same converters. The selected
SDK adapter and model determine which outgoing options and media they support.
These contracts are verified against `ai@6.0.185`, `@ai-sdk/openai@3.0.137`,
`@ai-sdk/anthropic@3.0.125`, and `@ai-sdk/google@3.0.146`.

## Supported conversions

| Input | Preserved semantics | Target boundary |
| --- | --- | --- |
| Chat Completions | `tool_choice` none/auto/required/named function; `parallel_tool_calls`; seed and frequency/presence penalties | Function choice uses SDK standard options. Disabling parallel calls requires an adapter that can express that constraint. |
| Responses | Function choices; parallel restriction; standard `reasoning.effort/summary`; `text.verbosity`, `truncation`, supported `include`/logprobs, `service_tier` | OpenAI-specific options require a supporting SDK adapter. Responses targets reject seed/penalties rather than silently dropping them. Standard `reasoning.effort` wins over the legacy top-level `reasoning_effort`. |
| Chat / Responses | `response_format` / `text.format` JSON object or JSON schema | Uses SDK `Output.json` / `Output.object`, including schema name/description and supported strictness controls. Generic Open Responses supports schema output but cannot express JSON object mode. |
| Anthropic | `output_config.format` JSON schema; native tool selection and parallel restriction; adaptive thinking `display` and `block_binding` | Uses SDK Output and native thinking options. Trusted Cherry reasoning selection replaces request thinking/effort while retaining unrelated options. The pinned SDK cannot express non-adaptive thinking display/binding controls. |
| Chat content | Image detail, WAV/MP3 `input_audio`, inline `file.file_data` with filename and media type | Audio requires model audio input capability. File/media acceptance remains adapter-specific. |
| Responses content | User and tool-result URL/base64 files; user image detail | Attachment-only messages survive. Tool-result files are relocated to user content with call-ID anchors. |
| Anthropic content | User and tool-result PDF URL/base64 and plain-text documents; title, context and cache metadata | Tool-result documents are relocated to user content with call-ID anchors. Compound document sources are unsupported. |
| Native output | Anthropic stop reasons/stop strings; SDK-provided OpenAI logprobs; reported Responses service tier | Streaming terminal events and complete responses retain available metadata. Length/filter/error outcomes retain priority over native metadata and completed tools. |

Gemini retains its existing safety/cache configuration, JSON/schema output, function
selection, penalties/seed, supported media configuration, signatures and native terminal
metadata. Pi text sessions retain their existing display capabilities.

## Adapter differences

The native OpenAI/Azure adapters and Cherry's derivatives of the OpenAI language models
can serialize native OpenAI controls. A generic OpenAI-compatible adapter does not gain
those controls merely by using an OpenAI-shaped endpoint. The pinned generic
`open-responses` adapter supports function choice, schema output and reasoning summary,
but lacks parallel restrictions and the additional native OpenAI options in the table.
Requests requiring those missing controls fail explicitly. Improving those adapters
belongs upstream; the gateway does not inject a second raw-body transport.

Parallel restrictions translate between supported OpenAI and Anthropic targets.
An explicit prohibition fails when the selected adapter cannot enforce it. Allowing
parallel execution does not require the model to emit more than one call.

## Explicit capability failures

The gateway rejects the following known unsupported semantics before upstream execution:

- Native built-in tools and unsupported built-in history blocks, including web search,
  code execution and tool search declarations. Client-owned function tools remain supported.
- Responses `previous_response_id`, `conversation`, enabled `background`, and `store:true`.
  Use stateless requests, `store:false` and complete caller-replayed history. GET/cancel
  and server-side response lifecycle are unavailable.
- Multiple Chat or Gemini candidates, Chat audio output, unsupported Responses tool choices
  and `include` values outside encrypted reasoning and output-text logprobs.
- Provider-bound `file_id` references. Supply portable URL/base64 content rather than assuming
  a file handle can be resolved against the selected provider's account.
- Known unsupported adapter controls and model-incompatible image/audio/video inputs.

HTTP returns a local invalid-request error identifying the unsupported functionality.
Object calls retain `UnsupportedFunctionalityError` without fabricating an upstream HTTP
status. Genuine upstream HTTP failures keep their actual status. Arbitrary unknown fields
are not a promise of native pass-through; this is a bounded semantic converter.

## Metadata and verification limits

The gateway consumes controlled SDK metadata; it does not infer missing provider information
from generated text. The pinned OpenAI SDK does not expose Chat actual service tier or refusal,
and its logprob projection does not retain token bytes. Missing Chat bytes remain null;
Responses byte arrays remain empty when unavailable, without re-encoding token text. Only
logprobs supplied by the selected SDK adapter can be returned. Citations and verbatim
incremental tool-argument streaming remain outside this contract; multiple complete function
calls remain supported.

`protocolSemantics.integration.test.ts` exercises actual HTTP routes, object transports,
production preparation/execution and SDK serialization using deterministic upstream wire
responses. It checks constraints, attachments, structured output, metadata, trusted selections,
capability failures and upstream errors. Existing protocol/runtime regressions protect usage,
reasoning replay, complete tools and cancellation. These tests do not claim paid-model
acceptance, live image generation, or new Pi multimodal UI behavior.
