# Agent Note: Forward gateway requests through one SDK execution path

Status: implemented

English | [中文](2026-11-09-gateway-sdk-forwarding.zh.md)

## Problem

The gateway must preserve harness context while retaining SDK provider compatibility. A native HTTP bypass duplicates endpoint, authentication, response observation, and billing responsibilities. The existing SDK converter also loses tool schema composition, tool errors, tool choice, and explicit cache metadata.

## Decision

All generation requests convert the inbound dialect to SDK messages, tools, and provider options, then use one caller-owned SDK invocation. The SDK provider adapter owns the outgoing protocol and transport. The gateway does not add an Agent loop, tool execution, AI repair, generation retry, or fallback. Ordinary application chat retains its existing loop.

Keep existing provider resolution, messageRules, compatibility middleware, tracing, and usage capture. Preserve supported caller semantics through the inbound converter: use SDK JSON schemas directly, retain tool-result error state, map tool choice, and carry explicit cache hints through provider metadata/options. Explicit caller cache settings take precedence over automatic cache placement. Supported Anthropic internal callers continue to prefer a configured Anthropic endpoint; other endpoint admission and fallback rules remain unchanged.

Remove the uncommitted native HTTP branch and its duplicate transport/rule/observation owners. The abandoned experiment remains only in local diagnostic artifacts. Unsupported protocol extensions are not claimed to survive SDK conversion.

## Alternatives considered

- Native HTTP body forwarding: preserves unknown wire fields but duplicates SDK provider behavior and does not meet the maintainer's intended ownership boundary.
- Keep the existing converters unchanged: silently loses caller semantics.
- Disable compatibility middleware: discards useful normalization for third-party endpoints.

## Consequences

SDK semantic forwarding does not promise byte-identical JSON, unknown request fields, or unknown response events. Provider adapters and compatibility rules can intentionally normalize supported values. Models and fixtures are bounded; a successful Qwen request does not prove every provider or extension compatible.

## Verification

- AC1 — `singleStep.test.ts`, `buildAgentParams.test.ts`, gateway streaming tests, and ordinary-chat billing tests cover single execution, prompt ownership, errors/cancellation, and the ordinary chat loop.
- AC2 — The four converter schema contracts and real SDK Anthropic wire tests cover schema references, error state, tool choice, and cache boundaries. The SDK dependency patch repairs missing local tool-result metadata forwarding.
- AC5 — TLC checked 168 states and 308 transitions: ten invariants and no-deadlock passed. Three old-converter counterexamples were replayed through the real SDK; changing model pricing during the request still produces one record at frozen prices.
- AC6 — An isolated Electron Durable → Qwen3.8 Flash request made one upstream call; the 25,734-character developer prompt, containing 14 skills, matched ingress exactly. HTTP 200, unified tracing, and one usage record were verified. The model invented additional skills in this sample; transport fidelity was not treated as answer-quality proof.

- AC3 — `anthropicAgent.integration.test.ts` checks actual SDK serialization of cache boundaries, tool errors, choice, signatures, and original schemas.
- AC4 — `proxyStream.stream.test.ts` and `providerBilling.integration.test.ts` cover separate instructions, errors/cancellation, ordinary chat loops, and billing.
