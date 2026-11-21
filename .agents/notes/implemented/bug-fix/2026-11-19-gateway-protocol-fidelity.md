# Agent Note: Preserve supported gateway protocol semantics

Status: implemented

English | [中文](2026-11-19-gateway-protocol-fidelity.zh.md)

## Problem

Generation requests pass through one Cherry provider and AI SDK invocation, but the remaining request converters omitted tool restrictions, output formats, attachments and provider options. Response adapters flattened native termination and omitted SDK-provided metadata. These losses affected HTTP and object callers of the same converters. Issue #24835 follows the merged #24786; its existing Gemini mappings and reasoning replay remain required.

## Decision

The repair stays at the existing converter, per-call options and response projection boundaries. It uses the installed SDK implementations (`ai@6.0.185`, OpenAI `3.0.137`, Anthropic `3.0.125`, Google `3.0.146`) as the capability authority. The provider adapter remains responsible for outgoing serialization, endpoint/model limitations and transport. Trusted Cherry request-selection priority is preserved without discarding unrelated options.

The converters map OpenAI function selection, parallel restrictions, standard Responses reasoning, supported generation options and structured output to SDK options. They map Chat audio/files, Responses files and Anthropic documents into file parts with their media and provider metadata. They reject provider-bound file IDs rather than resolving them against an unrelated account/provider. Response adapters preserve SDK-provided Anthropic native stop reasons/stop strings and OpenAI logprobs/Responses service tier, with length/filter/error outcomes retaining priority.

The gateway supports stateless single-candidate generation with caller-replayed history and client-owned function execution. The converters reject native built-in tools, server-side response state/background/storage requests, multiple candidates and other explicitly unsupported semantic controls before upstream execution. They report local capability failures as local errors, retaining genuine upstream HTTP status only for actual upstream failures. Built-in tool execution, state recovery and SDK-missing response data remain unsupported. Citations and verbatim incremental tool-argument streaming remain outside scope.

## Alternatives considered

- Forward native HTTP requests directly: duplicates provider resolution, transport, usage and compatibility ownership.
- Register native built-in tool factories alone: omits execution events/results and replay semantics.
- Preserve success while omitting unsupported controls or attachments: lets callers trust constraints or content that the model never received.

## Consequences

Explicit capability errors expose previously silent omissions and may require clients to disable unsupported features. Cross-provider semantics remain bounded by the selected SDK provider and model; vendor file handles cannot be made portable. Fixture-driven production-path tests verify conversion and serialization without claiming paid model acceptance or new Pi multimodal UI capabilities. Chat actual service tier and refusal are not exposed by the pinned OpenAI provider and must be fixed upstream before the gateway can report them.

The [single-SDK ownership decision](../architecture/2026-11-09-gateway-sdk-forwarding.md) remains unchanged. Native OpenAI/Azure and actual OpenAI-derived target adapters receive their supported options. Generic compatible/Open Responses gaps fail explicitly; no raw-body workaround is introduced.

## Verification

- AC1 — `protocolSemantics.integration.test.ts`: actual OpenAI/Anthropic SDK wire requests retain none/auto/required/named choice and parallel restrictions; unsupported generic adapters fail before transport.
- AC2 — `protocolSemantics.integration.test.ts`: all three protocols send SDK schema formats and preserve streaming/complete output and native truncation; Chat/Responses JSON mode and genuine Chat upstream 429 errors are covered.
- AC3 — `protocolSemantics.integration.test.ts`: WAV/MP3, image detail, PDF/base64/URL files, plain-text documents and parallel tool-result documents retain content/metadata; attachment-only messages survive and provider-bound handles fail.
- AC4 — `protocolSemantics.integration.test.ts`: standard Responses effort/summary, adaptive display/binding and trusted object reasoning priority are checked on serialized upstream bodies.
- AC5 — `protocolSemantics.integration.test.ts`: zero seed, penalties, tier, verbosity, truncation and include/logprobs survive native serialization; Responses-incompatible controls fail before transport and trusted tier selection suppresses conflicting body tier.
- AC6 — `protocolSemantics.integration.test.ts` and `protocolFidelity.test.ts`: native Anthropic stop strings/pause, OpenAI logprobs and reported Responses tiers survive complete/stream output; length/filter/error retain priority, including native context-window limits.
- AC7 — The focused gateway adapters, `anthropicAgent.integration.test.ts`, `proxyStream` tests, `agentApiGateway.test.ts` and `singleStep.test.ts` protect production HTTP/object semantics, signatures, parallel calls, usage, errors and cancellation.
- AC8 — `protocolSemantics.integration.test.ts`, the converter tests and `pnpm docs:check`: explicit capability failures and the bilingual [protocol compatibility reference](../../../../docs/dev/references/api-gateway/protocol-compatibility.md) cover built-ins, state/storage/background, candidates and adapter limitations.
