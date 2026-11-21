# Agent Note: Apply model parameter support after request overrides

Status: implemented

English | [中文](2026-11-18-model-sampling-support.zh.md)

## Problem

Missing catalog restrictions let compatible adapters send unsupported parameters. Kimi K3 restrictions exist only on selected provider offers, MiniMax M3 models advertise configurable sampling that the official API ignores, and Gemini penalty overrides can produce HTTP 400. GLM's official API requires top-p of at least 0.01, but runtime support types omit the catalog's nested range.

## Decision

Creator declarations own model-wide restrictions for Kimi K3 and MiniMax M3/M3.1 Flash. Official GLM 5-series ranges belong to the ZhiPu and Z.AI provider offers because other hosts can implement different bounds. GPT 5.6 Luna omits top-p based on the reported rejection. Retired models receive no new declarations.

Runtime support preserves catalog and persisted `range` values; legacy flat bounds remain accepted. Missing bounds stay unspecified. The final request filter clamps finite temperature/top-p values to declared ranges and removes unsupported frequency/presence penalties in camelCase and snake_case across standard parameters, provider namespaces, and body passthrough. Gemini 3/4 penalties are omitted even for models without registry metadata. Other request fields and nested application data retain their values.

## Alternatives considered

- Rely on each SDK: compatible adapters do not share native SDK filtering, and body overrides can bypass it.
- Disable sampling for every reasoning model: some active models support sampling, sometimes only in selected thinking modes.
- Put GLM bounds in the base model: hosted deployments can differ from the official API.
- Reject out-of-range settings: clamp at the existing final sanitation boundary so persisted settings remain usable.

## Consequences

Model-specific compatibility is declared in catalog sources and enforced after overrides. No database migration or settings rewrite is required. Accepted-but-ignored parameters are not described as provider errors. Official references: [Kimi K3](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart), [MiniMax](https://platform.minimax.io/docs/api-reference/text-chat-anthropic), [Gemini](https://firebase.google.com/docs/ai-logic/model-parameters?platform=flutter), [GLM](https://docs.z.ai/api-reference/llm/chat-completion).

## Verification

- Regression — Existing focused registry, model-service, request-builder, shared-model, and parameter-filter suites pass; no new behavior tests are added. Real provider requests are not performed.
