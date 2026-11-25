# Agent Note: Replay provider state across model routes

Status: proposed

English | [中文](2026-11-25-provider-state-replay.zh.md)

## Problem

Chat and Agents replay previous responses when a model continues a conversation or resumes a tool call. The history can include signed text, thinking, media and tool calls, encrypted reasoning, required plaintext thinking, or server-side continuation references. Their validity depends on the route that generated them and on the target protocol's rules. Chat currently records the selected model, which can differ from the model that served a fallback. Pi checks its native provider, API and model before the Gateway sees the request. A Base URL change can leave those values unchanged, and a Pi Durable registration change can alter them on the same route.

The [Gemini Chat fix](../../implemented/bug-fix/2026-11-25-gemini-chat-tool-signature-replay.md) handles foreign text and client tool signatures on native Gemini Chat requests. The [Anthropic prefix fix](../../implemented/bug-fix/2026-11-24-anthropic-thinking-prefix.md) handles selected prefix changes. Other failures occur before either replay rule can run. The current OpenAI-compatible adapter can lose a separate ciphertext frame, and an OpenRouter response with ciphertext and ordinary text can leave the ciphertext on step metadata that the next request does not read. A successful HTTP response alone cannot establish that the provider consumed the replayed state.

## Proposal

### Record the serving route when state is generated

Use the actual invocation to identify the source of each replayable block or item. Capture the provider connection, effective upstream endpoint, protocol, runtime adapter, and wire model ID. Include the effective project, deployment or account scope when the adapter can determine it and the protocol binds state to it. Store a stable identifier derived from routing configuration and omit credentials and transient runtime aliases. Record the serving attempt's identity for fallbacks and retries. A single assistant reply can contain parts from multiple attempts, so keep provenance at the replayable block or item boundary.

Keep state and optional provenance with the existing Chat parts and Pi native history. Preserve the association through save, reopen, fork, and compaction for retained parts. A summary gets only the state the summarizer actually produced. Historical records without route provenance use the existing adapter behavior, including the narrower stored-model check from the Gemini fix where available. Leave their source unknown when the original endpoint cannot be established.

### Decide from the target's replay contract

Each resolved conversational adapter declares the state formats it consumes, the replay unit and its ordering, the source scope it accepts, and any additional requirements. These can include the original context prefix, a required tool turn, or a server-side reference in a session with stored responses. An adapter that accepts ordinary history without replayable state declares that as well. A route can override an adapter default using the same provider, model and endpoint resolution as the [existing reasoning contracts](../../../../packages/provider-registry/src/schemas/provider-models.ts). Resolve this once for each serving attempt and pass it through to request serialization.

| Condition | Request behavior |
| --- | --- |
| Same source and target route, with the protocol's conditions satisfied | Replay the original state in its original unit and order, including empty-text blocks with state. |
| Completed history outside the target's supported source scope or with a known violation of a protocol condition | Omit the affected state from the outgoing request. Preserve ordinary content and compatible client tool call and result pairs. Let the target adapter handle its valid representation of provider-native tool history. |
| A pending tool continuation requires state bound to its original route | Continue on that route and apply the requested switch at the next turn boundary. If the route is unavailable, surface the continuation failure with the recorded tool results intact. |
| No state or an endpoint without conversation history | Keep normal message and request handling. |

First delivery uses the same-route rule. A later cross-route rule must identify the source and target scope and the state format, have a documented protocol guarantee, and have a real endpoint check with the original state on the wire and a result that demonstrates it was consumed. HTTP success, the same model slug, and matching field names alone are insufficient. Affected state stays in storage. Explicit omission reaches the final serializer so it cannot backfill the field with a placeholder.

Use the protocol's own binding check where the adapter supports it. For local history rewrites, use the existing rewrite boundaries and the protocol's dependency rules to omit affected historical state. For example, an Anthropic prefix change can invalidate later signed blocks even on the same route. Keep contiguous sequences where required. Scope any server-side continuation reference to the route and storage mode that own it. [Anthropic prefix rules](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks) · [Vertex thought signatures](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking/thought-signatures#constraints-and-limits)

### Apply the same decision in Chat and Agent runtimes

Add a shared decision in Main's AI domain. An AI SDK `RequestFeature` contributes middleware. Its `wrapStream` and `wrapGenerate` associate decoded state with the serving attempt, and `transformParams` evaluates the prompt after history edits and compaction and before provider serialization. Adapters own decoding, block placement and final wire fields. When the SDK does not expose state that the provider returned, repair the decoder or Gateway conversion at that boundary. Response capture must handle metadata-only events and non-streaming responses alike. [AI SDK request composition](../../../../docs/dev/references/ai/params-pipeline.md)

Pi and Pi Durable keep their native transcript and tool loop. Apply the same decision in the binding before Pi converts the request, using the same effective route that the trusted object transport uses for that attempt. Carry provenance and any explicit omission needed by the final adapter through the trusted in-process call. A runtime registration name remains usable for lookup without determining replay scope. [Pi binding](../../../../src/main/ai/runtime/pi/gatewayModelBinding.ts) · [Native Agent object transport](../../implemented/architecture/2026-11-18-agent-object-transport.md)

Claude Code keeps its native transcript and tool loop. For authenticated Agent sessions, the Gateway stores provider state and provenance in the existing session checkpoint, matches it to the assistant blocks Claude Code returns, and passes it to the same AI SDK replay decision. It selects the original route before conversion when the tool loop needs it. Signatures already carried by Anthropic blocks remain part of the wire contract. Unmatched or ambiguous records do not add state to the request. Direct subscription sessions and external Gateway clients retain their native history rules.

### Implementation sequence

1. Add captured-request fixtures for the existing gaps and repair the adapters where state is lost before normalization or at serialization. Start with Gemini's compatible tool signatures, OpenRouter's no-tool ciphertext, flat Chat ciphertext and xAI Responses namespaces. Verify the response-to-request round trip with the pinned SDKs and production Gateway converters.
2. Add serving-route provenance and the shared AI SDK decision. Migrate existing app-owned replay rules as their target adapters pass equivalent checks. Verify known route changes, A → B → A, fallback attribution, legacy history and local prefix rewrites.
3. Connect Pi and Pi Durable through the existing object binding. Verify native reopen, the pending tool path, and a same-route registration change. Exercise representative real-provider Chat and Pi Durable flows in Electron before closing the Spec.
4. Connect Gateway-backed Claude Code using session-scoped state associated with the returned Anthropic blocks. Verify an Anthropic request and response round trip followed by replay on the original route or a switch to another provider.

## Alternatives considered

- Compare model IDs or signature fields alone. A model can use different endpoints, projects or adapters, and a single format can have different replay rules.
- Strip all reasoning after a route change in Gateway middleware. This loses required current-turn state and misses provenance and state that Pi removed before the Gateway call.
- Probe cross-route compatibility by sending the state and retrying on HTTP 400. A provider can silently ignore it, and a retry after tool execution cannot establish safe continuation.

## Acceptance criteria

- AC1 — State from a successful Chat fallback is attributed to the route that served it. Chat and Pi Durable detect a configured endpoint, protocol or Base URL change under the same connection and model IDs, and reopening the same Pi route retains its identity across runtime registrations. (verification: unit, owner: request routing and Pi runtime maintainers)
- AC2 — A compatible same-route sequence replays original signed or encrypted state after save and reopen. The captured outgoing request keeps byte values, block order and tool associations, including state carried in empty-text or metadata-only responses. (verification: unit, owner: adapter and history maintainers)
- AC3 — A completed cross-route history with unknown compatibility sends the supported text and paired client tool history with the foreign state omitted and no substituted signature. The original stored parts are intact and replay again after a compatible switch back. (verification: unit, owner: AI SDK and Pi runtime maintainers)
- AC4 — A route change or fallback during a tool continuation with required state stays on the original route while available. An unavailable route produces a continuation failure without another tool execution or a request with missing required state. (verification: unit, owner: Chat and Pi runtime maintainers)
- AC5 — A verified prefix change excludes the affected historical state from the final payload on a prefix-bound route. Retained, compatible state still replays when the relevant prefix is unchanged. (verification: unit, owner: context and adapter maintainers)
- AC6 — Captures cover Generate Content, Messages, Chat Completions variants, Responses variants and Ollama Chat, including required plaintext, encrypted state and provider-side references. Legacy, caller-owned and non-conversational requests retain their existing history ownership and valid request behavior. (verification: unit, owner: adapter and Gateway maintainers)
- AC7 — A real Chat run and a real Pi Durable run show same-route tool continuation and a switch between completed turns. Inspect the final upstream requests to verify retained state, omitted foreign state, and tool call and result pairing. (verification: Electron, owner: implementation integrator)
- AC8 — Gateway-backed Claude Code restores matched state after reopening a session and applies the same route rules to the next upstream request. The provider state does not cross Agent sessions or appear on an unrelated assistant block. (verification: unit, owner: Gateway and Claude Code runtime maintainers)

## Risks

- A gateway may hide the actual upstream deployment or change it behind a stable alias. Same-route replay relies on the identity the provider exposes and on its documented contract. An opaque alias supplies no evidence for a cross-route rule.
- Omitting foreign state can reduce reasoning continuity. Keep the original state in storage and keep the active tool sequence on its originating route when it requires that state.
- A protocol converter may retain state on a step without attaching it to the part that is replayed. Fixtures must exercise the next final request after real history conversion and reload, not just the decoder output.
