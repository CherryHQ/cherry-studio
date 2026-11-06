# Agent Note: Work respects declared model tool capability

Status: implemented

English | [中文](2026-11-06-work-tool-capability.zh.md)

## Problem

Work (agent session) traffic could reach a provider with tool definitions even when the selected model does not declare function-call support. Claude Code's direct Anthropic route bypasses the shared `buildAgentParams` gate, so models whose capabilities omit `function-call` still received native/MCP tools on that route. Work also had no notice explaining text-only operation. A provider rejection (`code 20037`, `Function call is not supported for this model.`) surfaced as a generic bad-request/unknown error, and status-prefixed JSON messages lost the provider's own sentence.

## Decision

`agentSessionWarmup.ts` includes `function-calling-unsupported` as a gateway-degrade reason, evaluated through `isFunctionCallingModel` for each resolved primary/plan/small slot. The Work composer shows `code.model_tools_unavailable` as an informational notice while keeping the turn sendable.

`tool_calling_unsupported` is an error category recognized by `isToolCallingUnsupportedErrorMessage`. Safe provider-message extraction recovers the provider sentence from a status-prefixed JSON envelope. The renderer offers provider-settings navigation for this category and a `Switch model` action in the warning toast.

## Alternatives considered

- Blocking non-tool Work turns: rejected because Pi, Pi Durable, and the gateway already support text-only operation; blocking those turns creates a regression.
- Blanket capability blocking in the shared gate: the existing `buildAgentParams` gate already excludes client tools for incapable models; it does not cover Claude Code's direct route.
- Sanitising assistant custom raw-body `tools` parameters: a real second bypass, but assistant-scoped and outside this change.
- Inferring capability from model names or the vendor code: rejected because capability data is per-model, explicit, and user-overridable; a bare `20037` does not establish unsupported tool calling.

## Consequences

An incapable resolved Claude slot sends the connection through the internal gateway. Connections whose resolved slots support function calling retain the direct route when otherwise eligible. The composer explains text-only operation, and provider capability rejections receive a specific diagnosis alongside the provider's message. Explicit user capability deltas still take precedence. The independent provider-native server-tool (web search) policy is unchanged. Assistant raw-body `tools` parameters remain a known, unfixed bypass.

## Verification

- Regression — `src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts`: an incapable primary uses the gateway, incapable plan/small slots record `function-calling-unsupported`, capable selections retain direct routing, and external-CLI routing and pinning remain unchanged.
- Regression — `src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`: the existing shared gate excludes a client tool supplied through `callOverrides` for an incapable model and retains it for a capable model.
- Regression — `src/shared/utils/__tests__/errorCategory.test.ts`: explicit function/tool-calling rejection phrases classify as `tool_calling_unsupported`; a bare vendor code, unsupported parameter, malformed arguments, and MCP execution failure do not; structured server status takes precedence.
- Regression — `src/shared/ai/__tests__/providerError.test.ts`: status-prefixed JSON exposes the provider sentence, ordinary messages remain intact, and recovered detail respects the length bound.
- Regression — `src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`: an incapable model displays the notice without disabling send after text entry; selecting a capable model removes the notice and keeps send enabled.
- Regression — `src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx`: a plain status-prefixed JSON error displays the capability diagnosis, the provider sentence, and the settings action.
