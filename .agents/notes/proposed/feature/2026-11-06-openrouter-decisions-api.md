# Agent Note: OpenRouter Decisions API client for Jev models

Status: proposed

English | [中文](2026-11-06-openrouter-decisions-api.zh.md)

## Problem

OpenRouter exposes Jev models such as `typesafe/jev-1.13` through the alpha Decisions API (`POST /api/alpha/decisions`), which takes `model`, `state` and `questions` and returns typed answers (`choice`, `noul`, `score`) rather than assistant text. The conversational chat-completion flow cannot carry this protocol (#20806).

## Proposal

- Add a main-process `decisionsService` that calls the Decisions endpoint with the OpenRouter provider's API key and base-URL origin, validates the response, and raises a typed `DecisionsError` on failure.
- Add shared request/answer schemas and a `decisions.create` IpcApi route so a future renderer surface can call it.
- Non-goals: any UI, assistant tool, or chat integration; those wait for a maintainer decision on the surface. Registering Jev as a non-chat model in the provider registry is a follow-up once the registry's model-type handling is confirmed.
- `response_format` through Custom Parameters remains the generic path for ordinary structured output.

## Alternatives considered

- Model Jev as a chat model with `response_format`: rejected, the Decisions protocol is a different endpoint and result shape.
- Renderer-side fetch: rejected, API keys live in the main process.

## Acceptance criteria

- AC1 — A Decisions request posts `model`, `state` and `questions` to `/api/alpha/decisions` with bearer auth (verification: unit)
- AC2 — `choice`, `noul` and `score` answers are parsed and malformed answers are rejected (verification: unit)
- AC3 — HTTP failures surface as `DecisionsError` carrying the status (verification: unit)
- AC4 — `decisions.create` is callable over IpcApi (verification: unit)

## Risks

The endpoint is alpha and its schema could not be verified against live OpenRouter; the answer schema is loose on extra fields so it can be adjusted cheaply.
