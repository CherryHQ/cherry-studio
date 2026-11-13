# Agent Note: Preserve Claude Code client identity through the gateway

Status: implemented

English | [中文](2026-11-12-gateway-client-identity.zh.md)

## Problem

Managed Claude Code models moved from direct provider access to the loopback gateway. SDK reconstruction dropped CLI identity headers, so relays admitting only Claude Code clients could reject previously valid turns with 403. The reported relay is unidentified; local fixtures cannot establish its acceptance.

## Decision

Preserve `user-agent`, `x-app`, and `x-client-app` only for authenticated internal Anthropic input where the transport that will actually be used speaks Anthropic Messages with a host-issued `claude-code` runtime capability bound to the session id and validated with the unrestricted internal credential. The shared internal key and session-id header alone cannot distinguish Pi from Claude Code. The ai-owned `src/main/ai/agentSession/agentRuntimeCapability.ts` registry holds one unguessable token per session id for the process lifetime, cleared at gateway stop. Resolution requires the session to exist, be open and not closing, and currently use the Claude Code runtime. Parking and revisiting reuse the same token and warm-query environment. Shutdown fences both listener starts and issuance. Main-process callers are trusted: this is a bearer token, not isolation between hostile main-process code. Placement follows [Main Process Architecture §3](../../../../docs/dev/references/architecture/main-process.md): features may depend on ai, never the reverse. The Claude Code runtime helper attaches it; Pi receives only the shared credential and usage headers.

Skip missing or empty values, Connection-nominated names, and values containing the presented credential or runtime capability. Provider `extraHeaders` use last-entry-wins case-insensitive normalization; only non-empty effective values suppress forwarding. Bedrock/Vertex builders do not pass these overrides into provider settings. Pass the filtered identity through stream request options in both response modes; provider execution continues to own credentials and transport merging.

## Alternatives considered

- Restore direct routing: bypasses the recorded managed-model gateway decision.
- Trust the internal key or session-id header alone: Pi shares the internal helper and could forward forged identity.
- Forward arbitrary caller headers or change transport precedence: leaks internal context or overrides configured relay identity.
- Force an exact User-Agent in custom fetch: bypasses the SDK contract for a relay-specific assumption.

## Consequences

Provider/model routing remains unchanged. Public callers, requests without a valid Claude Code capability, OpenAI input and non-Anthropic transports receive no forwarded CLI identity. Cherry internal headers are excluded. Values containing the presented credential (including a scoped credential) or runtime capability are rejected. Developer-mode HTTP tracing redacts by header name, not by value; this guard controls the wire, not logs. Transport probing uses the serving config dispatch and SDK factory with a dummy credential, without network I/O or credential rotation. Advertising Anthropic Messages while serving another transport (including Ollama) forwards nothing: standard Anthropic, NewAPI, AiHubMix, DMXAPI, and CherryIN are admitted only if the constructed model speaks Anthropic Messages. Unknown adapters, missing endpoint configuration, and preset models constructing other dialects fail closed. The SDK appends a provider-utils/Node runtime suffix to User-Agent; prefix preservation is verified, exact byte identity is not. The other identity values survive verbatim after trimming.

## Verification

- Regression — `src/main/features/apiGateway/__tests__/clientIdentity.test.ts`: selector policy, provider precedence, hop-by-hop exclusion and credential-value protection.
- Regression — `src/main/features/apiGateway/__tests__/anthropicAgent.integration.test.ts`: enforcing relay rejects missing CLI identity before the fix; both response modes complete tool replay after it, retaining upstream authentication and provider User-Agent precedence.
- Regression — `src/main/features/apiGateway/routes/__tests__/routes.integration.test.ts`: real unrestricted credential plus session-bound Claude capability admits identity through both authentication paths; Pi credential plus Pi’s own session id, scoped credentials, missing/forged/inactive capabilities, mismatched sessions and public callers receive none.

- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`: close/reopen and Pi reassignment check current liveness; reissue returns the same token. Route tests verify stable warm-query hash inputs across parking and revisiting, production secret-guard wiring, listener-start failure, and shutdown races. Gateway route tests drive real closeSession and gateway stop; adapter tests preserve relay status 403 and message in both response modes and exclude CLI identity for ordinary chat.
