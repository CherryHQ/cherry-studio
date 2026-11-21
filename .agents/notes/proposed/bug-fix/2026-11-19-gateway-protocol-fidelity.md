# Agent Note: Preserve supported gateway protocol semantics

Status: proposed

English | [中文](2026-11-19-gateway-protocol-fidelity.zh.md)

## Problem

Generation requests pass through one Cherry provider and AI SDK invocation, but the remaining request converters silently omit tool restrictions, output formats, attachments and provider options. Response adapters flatten native termination and omit SDK-provided metadata. These losses affect HTTP and object callers of the same converters. Issue #24835 follows the merged #24786; its existing Gemini mappings and reasoning replay remain required.

## Proposal

Repair the existing converter, per-call options and response projection boundaries. Use the installed SDK implementations (`ai@6.0.185`, OpenAI `3.0.137`, Anthropic `3.0.125`, Google `3.0.146`) as the capability authority. Keep the provider adapter responsible for outgoing serialization, endpoint/model limitations and transport. Preserve trusted Cherry request-selection priority without discarding unrelated options.

Map OpenAI function selection, parallel restrictions, standard Responses reasoning, supported generation options and structured output to SDK options. Map Chat audio/files, Responses files and Anthropic documents into file parts with their media and provider metadata. Reject provider-bound file IDs rather than resolving them against an unrelated account/provider. Preserve SDK-provided Anthropic native stop reasons/stop strings and OpenAI logprobs/Responses service tier, with length/filter/error outcomes retaining priority.

The gateway supports stateless single-candidate generation with caller-replayed history and client-owned function execution. Reject native built-in tools, server-side response state/background/storage requests, multiple candidates and other explicitly unsupported semantic controls before upstream execution. Report local capability failures as local errors, retaining genuine upstream HTTP status only for actual upstream failures. Do not implement built-in tool execution, state recovery or SDK-missing response data in this repair. Citations and verbatim incremental tool-argument streaming remain outside scope.

## Alternatives considered

- Forward native HTTP requests directly: duplicates provider resolution, transport, usage and compatibility ownership.
- Register native built-in tool factories alone: omits execution events/results and replay semantics.
- Preserve success while omitting unsupported controls or attachments: lets callers trust constraints or content that the model never received.

## Acceptance criteria

- AC1 — OpenAI none/auto/required/named function choices and parallel restrictions survive actual SDK serialization to supported target endpoints. (verification: unit)
- AC2 — Chat, Responses and Anthropic JSON/schema output reaches the SDK Output path; streaming and complete responses preserve truncation/errors. (verification: unit)
- AC3 — URL/base64 files, WAV/MP3, image detail and Anthropic user/tool-result documents retain content and applicable metadata; attachment-only messages survive and provider-bound file IDs fail explicitly. (verification: unit)
- AC4 — Standard Responses reasoning and Anthropic thinking details survive native mapping; trusted reasoning selection replaces reasoning alone. (verification: unit)
- AC5 — Supported Chat seed/penalties and endpoint-specific OpenAI tier, verbosity, truncation, include/logprobs options survive actual SDK serialization without inventing unsupported Responses seed/penalties. (verification: unit)
- AC6 — Streaming and complete responses retain SDK-provided Anthropic native stops/stop strings, OpenAI logprobs and Responses service tier; native metadata cannot override failure/length/filter priority. (verification: unit)
- AC7 — Production HTTP/object preparation and execution regressions catch semantic loss and protect reasoning signatures, complete parallel tool calls, usage and error/abort behavior. (verification: unit)
- AC8 — Unsupported built-ins, server-side Responses state/background/storage and multiple candidates fail explicitly; reference documentation states the support matrix and evidence limits. (verification: unit and docs gate)

## Risks

Explicit capability errors expose previously silent omissions and may require clients to disable unsupported features. Cross-provider semantics remain bounded by the selected SDK provider and model; vendor file handles cannot be made portable. Fixture-driven production-path tests verify conversion and serialization without claiming paid model acceptance or new Pi multimodal UI capabilities. Chat actual service tier and refusal are not exposed by the pinned OpenAI provider and must be fixed upstream before the gateway can report them.
