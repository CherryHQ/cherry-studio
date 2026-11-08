# Agent Note: Preserve Agent request controls through the internal gateway

Status: implemented

English | [中文](2026-11-07-agent-gateway-request-controls.zh.md)

## Problem

Agent turns capture reasoning effort, service tier and Fast selections, but the desktop bridges interpreted them differently. Claude omitted service tier and encoded reasoning into Anthropic fields before the gateway translated it again. Pi sent the original reasoning header while also mapping native thinking levels and target dialects. Its connection comparison treated `default` and `auto` as equivalent even though their headers differ.

A native request capture reproduced a second consequence: Pi received `maxTokens: 256` and native `reasoning: high`, then sent `max_tokens: 16640`. The original product selection was already carried separately. Native thinking therefore enlarged a call-specific cap before the provider request builder could apply the product's choice.

## Decision

Claude Gateway connections carry the captured reasoning, tier and Fast selection through authenticated internal headers. Fast always writes an explicit boolean, including `false`, over inherited custom headers; provider-model eligibility belongs to the request builder. These selections remain connection rebuild facts. The external-cli route retains native Claude thinking and eligible native Fast options and receives no internal request-control headers.

Claude's startup baseline consumes the captured materialization facts without rereading model or provider rows after asynchronous setup. Native Fast records the value used by SDK settings; later reconciliation reads current facts and detects a changed native setting. Gateway Fast records the original selection. Model slots are assembled once in the warmup route; environment setup no longer queries or generates temporary model identities. Stream defaults remain in the settings builder.

Pi and Durable share a gateway binding that clears native request reasoning before native serialization. It retains explicit call caps, cancellation, context capacity, response parsing and replay metadata. The gateway forwards the captured product selection to the existing AI SDK parameter builder. Desktop Pi thinking-level and adaptive-dialect projections are removed. Independent runtime packages retain their native configuration APIs.

The binding registers native model metadata directly; the separate model-injection builder is removed. Upstream store and developer-role compatibility guesses do not configure the loopback client. Protocol routing, image support, context and output limits, and CherryIN empty-signature replay remain. Zero native costs stay explicit because extension registration does not apply the configuration-file loader's defaults; Cherry remains the billing owner.

Pi compares the original normalized reasoning selection when reconciling a connection. Gateway Fast processing is applied once by the provider request builder. Public gateway clients retain their protocol-defined request parameters; external headers cannot supply authenticated internal selections.

## Alternatives considered

- Keep both reasoning interpreters: native clamping and budget expansion can change a request before the authoritative builder sees it.
- Remove native output limits or compaction metadata: summaries, verifier calls and context management have legitimate consumers of those values.
- Remove the AI SDK thinking-budget adjustment: the installed Anthropic adapter adds the thinking budget during serialization; that adjustment has a separate SDK contract.

## Consequences

The desktop native request's reasoning fields are transport scaffolding. The final provider request carries the product choice. Warm connections still freeze their selections; this change adds no session configuration store or live mutation mechanism.

Optional response metadata, malformed tool calls, stream truncation and error retry classification remain separate compatibility work. No dependency is upgraded or newly patched.

## Verification

- Regression — `src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts`: captured controls override inherited headers, CLI Fast changes after materialization require rebuilding, a captured request survives a subsequent model deletion until reconciliation, model slots retain independent fallback identities, and CLI subscriptions retain native thinking without internal headers.
- Regression — `src/main/ai/runtime/pi/gatewayModelBinding.test.ts`: the installed native SDK preserves a 256-token call cap despite conflicting native reasoning, routes supported protocols with internal credentials, retains native model capacities and image capability, and preserves Google and CherryIN replay content.
- Regression — `src/main/ai/runtime/pi/gatewayIntegration.test.ts`: production gateway execution sends `high` and `ultra` to a controlled upstream, ignores conflicting Anthropic thinking when a trusted original selection exists, and retains replay and billing behavior.
- Regression — `src/main/ai/runtime/pi/PiRuntimeConnection.test.ts`: switching between `default` and `auto` rebuilds the connection instead of retaining old headers.

These are offline SDK and loopback integration checks. They do not establish real-provider or Electron acceptance.
