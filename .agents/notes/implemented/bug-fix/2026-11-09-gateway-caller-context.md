# Agent Note: Preserve caller-owned gateway context through AI SDK

Status: implemented

English | [中文](2026-11-09-gateway-caller-context.zh.md)

## Problem

Pi Durable sends its identity and skill catalog in a Responses developer message. The gateway normalized that message to a system message, then `buildAgentParams` assembled Cherry's deferred-tool prompt and set `systemMessageMode: 'remove'`. The outgoing request lost the caller's system messages and sent only Cherry's replacement instructions. This removed the caller's skill catalog before inference; preserving that catalog does not guarantee correct model answers.

Moving Cherry-owned chat prompts to Responses instructions remains intentional: it prevents relays from supplying default instructions and avoids duplicating the assembled prompt. The bug was applying this policy to caller-owned context.

## Decision


`contextOwner: 'caller'` covers prompts and tools as well as history. Caller requests retain `request.system` and client tool definitions without Cherry's prompt assembly, registry selection, deferred exposition, or web-tool routing. `disableTools` remains effective. Normal chat retains its existing prompt assembly and Responses instructions behavior.

For Responses input targeting Responses output, top-level `instructions` travels through the resolved provider-options namespace independently of the input messages, including empty instructions and trusted reasoning overrides. Cross-protocol requests retain converter-based prompt mapping. System/developer turns stay in the message sequence; AI SDK may normalize their wire roles.

The existing AI SDK execution path, `messageRules`, feature collection, compatibility middleware, and tracing remain active. Context ownership is not a raw HTTP bypass or a guarantee that unknown protocol fields survive SDK conversion.

Caller-owned requests use AI Core's `streamText` / `generateText` with one step,
zero retries, and tool execution removed. They do not construct `ToolLoopAgent`
or install AI tool repair or `prepareStep`; AiService also omits retry/fallback
wrappers. The shared stream lifecycle retains usage observers, cancellation,
and error delivery. Ordinary Cherry chat keeps its tool loop.

## Alternatives considered

- A raw proxy without shared compatibility policy: loses provider middleware. The SDK forwarding path retains shared provider and schema rules.
- Remove `systemMessageMode: 'remove'` globally: changes normal chat delivery and leaves gateway prompt injection in place.
- Rely on tools having no `execute` inside `ToolLoopAgent`: leaves AI repair and future continuation behavior coupled to the gateway.
- Restore only the skill catalog: repairs one symptom while leaving identity and later system turns vulnerable.

## Consequences

Gateway clients own tool discovery and agent context. Cherry no longer adds deferred-tool instructions just because a client exposes `tool_search`. Provider compatibility transformations still apply. Trusted gateway requests join the owning Agent session trace through in-process correlation.

## Verification

- Regression — `src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts` covers absent, empty, and explicit instructions, multiple system turns, caller tools, and the active Responses `strict: false` compatibility middleware. Normal chat instructions tests remain in the same suite.
- Regression — `src/main/features/apiGateway/__tests__/proxyStream.stream.test.ts` uses the real Responses converter to keep instructions separate from developer messages with a trusted reasoning override.
- Regression — Isolated Electron Pi Durable → Qwen3.8 Flash preserved the developer prompt exactly (25,734 characters, 14 skills), without diagnostic body replacement. HTTP 200, SDK/HTTP tracing, and one usage record were verified. The model still invented additional skills in this sample; context preservation does not guarantee answer quality.

- Regression — `src/main/ai/runtime/aiSdk/loop/__tests__/singleStep.test.ts` exercises real AI SDK execution: one outgoing call, no local execution or repair, no retry after HTTP 503, preserved middleware and message normalization, cancellation before invocation, and ordinary chat tool continuation.
