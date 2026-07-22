# AI SDK v7.0.0 — Source-Grounded Feature Inventory

> Read from the actual monorepo at `/Users/suyao/conductor/workspaces/ai/tallinn` (HEAD = `v7.0.0` tag), not docs.
> Companion to [`aisdk-v7-research.md`](./aisdk-v7-research.md) (upgrade-cost analysis) and [`architecture.md`](./architecture.md) (our design). 70 packages; this covers what's NEW.
> Legend: 🟢 stable · 🧪 experimental · ⭐ high relevance to Cherry's unified runtime.

## A. Agent abstraction (3 layers) — `packages/ai/src/agent/`, `packages/harness/`

```
Agent (interface, 🟢)  →  ToolLoopAgent (🟢, generic LLM loop)  →  HarnessAgent (🧪, wraps CLI agents)
```

- **`Agent`** — interface: `generate(opts)` / `stream(opts)`, both model-agnostic. `version: 'agent-v1'`.
- ⭐ **`ToolLoopAgent`** (`agent/tool-loop-agent.ts`) — 🟢 stateless `while(toolCalls)` loop. This is what Cherry's `runtime/aiSdk` already uses. Settings now include (final names): `model`, `tools`, `instructions`, `allowSystemInMessages`, `stopWhen` (default `isStepCount(20)`), `toolApproval`, `prepareStep`, `runtimeContext`, `activeTools`, `toolOrder`, `output`, `telemetry`, `include`, `prepareCall` (prompt-template hook), `onStepEnd`/`onEnd`/`onToolExecutionStart`/`onToolExecutionEnd`. Per-call: `timeout`, `experimental_sandbox`.
- **`HarnessAgent`** (`harness/src/agent/harness-agent.ts`) — 🧪 drives third-party CLI agents. **Requires a sandbox provider.** Explicit session lifecycle: `createSession()` → `generate/stream({session})` → `continueGenerate/continueStream` (for tool-approval resume) → `session.compact()/detach()/stop()/destroy()/suspendTurn()`. `permissionMode: 'allow-all'|'allow-edits'|'allow-reads'` for builtin tools; `toolApproval` for user tools.
  - Adapters (each 🟢 itself, but the harness layer is 🧪): **claude-code** (Anthropic, bridge+WebSocket), **codex** (OpenAI, *no* builtin approval → forces `allow-all`), **pi** (flexible model, **in-process, no bridge** → works with `just-bash`), **opencode** (configurable provider+model, bridge).
  - **This is the black-box-wrapper path Cherry rejected.** Anthropic/OpenAI-locked per adapter, sandbox-required, experimental. Confirms: don't adopt; our `claudeCode` driver already fills this niche if ever wanted.

## B. Core `ai` package — v6→v7 deltas — `packages/ai/src/`

| Area | Final v7 API | Was (v6) | Cherry |
|---|---|---|---|
| ⭐ **Loop control** | `experimental_streamLanguageModelCall()` exported (`generate-text/stream-language-model-call.ts`) — see note below | internal only | build custom loops without forking SDK internals — but our loop already works |
| ⭐ **Tool approval (`G`)** | `toolApproval`: fn or `{[tool]: status}`; returns `ToolApprovalStatus` = `'approved'\|'denied'\|'user-approval'\|'not-applicable'` (+ `{type,reason}`); async OK; fn gets `{toolCall,tools,toolsContext,runtimeContext,messages}`. Resume mid-run via `continueGenerate`/`continueStream({toolApprovalContinuations})` | `needsApproval` on tool def | **native home for our lifted `G`** |
| ⭐ **Context (3 layers)** | `runtimeContext` (ambient, mutable per-step) **+** `toolsContext` (per-tool, isolated, validated by each tool's `contextSchema`, computed via `InferToolSetContext`). `ToolExecutionOptions = {toolCallId, messages, abortSignal, context /*per-tool*/, experimental_sandbox}` | single `experimental_context` blob | `runtimeContext`=our `C` carrier; `toolsContext` isolation = safe for untrusted MCP. Full design in [`architecture.md`](./architecture.md) §4 |
| ⭐ **Call options / templating** | `CALL_OPTIONS` generic + `callOptionsSchema` (zod-validated per-call args) + `prepareCall` (expands them → prompt/settings). Prompt templating / parameterized presets. **Already in v6.** | — | the "Agent = preset `C`" mechanism (translate, named assistants); chat keeps `CALL_OPTIONS=never` |
| **Lifecycle callbacks** | `onStart` / `onStepStart` / `onStepEnd` / `onEnd` / `onToolExecutionStart` / `onToolExecutionEnd` (+ embed/rerank `onEmbedEnd`/`onRerankEnd`); **`onAbort({steps})`** fires on abort (mutually exclusive with `onEnd`; also a `{type:'abort'}` stream part) — **already in v6** | `experimental_on*` / `onStepFinish` / `onFinish` / `experimental_onToolCallStart`/`Finish` | `composeHooks`+`AgentLoopHooks` already mirror these (the v6 `wrapToolsWithExecutionHooks` shim deletes at v7); **`onAbort`/`{type:'abort'}` part = v6 do-now abort-terminal cleanup** (migration-plan "Independent v6-now cleanups") |
| **`prepareStep`** | richer args: `initialInstructions`/`initialMessages`/`responseMessages`/`toolsContext`/`runtimeContext`/`experimental_sandbox`; may override model/messages/activeTools/toolChoice/runtimeContext/toolsContext | `experimental_prepareStep`, fewer fields | our `C`-maintenance + safety-tool-removal hook (red line: **no** `toolChoice`/orchestration) |
| **Tool input/exec control** | `experimental_refineToolInput`, `experimental_repairToolCall`, `toolOrder`, `activeTools` | `experimental_repairToolCall` only | repair already used in `AiService`; `toolOrder`/`refineToolInput` new |
| **Deferred tool execution** | a tool may omit `execute` → emitted as a tool-call for the client/approval flow to fulfill, result fed back | — | Cherry already has `runtime/aiSdk/prompts/deferredTools.ts` |
| ⭐ **End-to-end tool typing** | `InferAgentUIMessage<typeof agent>` → `useChat<…>()`; `InferUITools`/`InferUITool`; `UIMessage<META,DATA,TOOLS>` — tool input/output types flow compile-time to the UI. **Mostly v6.** | — | static for built-ins, dynamic-untyped for MCP; see [`architecture.md`](./architecture.md) §4.5 |
| **Reasoning (unified)** | top-level `reasoning?: 'provider-default'\|'none'\|'minimal'\|'low'\|'medium'\|'high'\|'xhigh'` (V4 spec) → each first-party provider maps to native thinking/effort; output `reasoning` + `reasoning-file` parts | provider-specific via `providerOptions` | retire effort-setting in `qwenThinking`/`noThink`/`openrouterReasoning` (first-party); keep `reasoningExtraction` (output) |
| **Timeouts** | `timeout: number \| {totalMs,stepMs,chunkMs,toolMs, tools:{<name>Ms}}` | single value | per-tool MCP timeouts |
| **Stop conditions** | `isStepCount(n)`, `isLoopFinished()`, `hasToolCall(...)`. Defaults: `streamText` = `isStepCount(1)` (**no loop!**), `ToolLoopAgent` = `isStepCount(20)` | `stepCountIs` | watchdog only (per our contract) |
| ⚠️ **Result shape** | `result.stream` (was `fullStream`); `result.usage` = **all-steps total**; `result.finalStep.usage` = last step; top-level `request`/`response`/`providerMetadata` → `finalStep.*`; `result.responseMessages` stable; `step.response.messages` no longer accumulates | `fullStream`; `usage`=final, `totalUsage`=all | **usage meaning inverted — silent break** |
| **Include** | `include:{requestBody,requestMessages,responseBody,rawChunks}` all default `false` | bodies on by default | less memory |
| **Prompt** | `instructions` (was `system`); `allowSystemInMessages:false` default rejects system role in messages (anti-injection) | `system` | rename + audit message arrays |
| **Media parts** | unified `{type:'file', mediaType, data}`; `{type:'media'}` removed | `image-*`/`media`/`file-*` | audit attachment rendering |
| **File upload (remote)** | `uploadFile({api: provider.files()})` → `ProviderReference` (`{[provider]: fileId}`); attach `{type:'file', data: ref}` instead of base64; multi-provider merge. **v7-only**, `.files()` = anthropic/google/openai/xai | base64 inline / provider-specific | unifies Cherry's existing `src/main/services/remotefile/`; the **large-file fix is just wiring** (`resolveFileUIPart` still base64s) — v6, not blocked. See [`../large-file-upload-port.md`](../large-file-upload-port.md) |
| **Speech/transcribe** | `generateSpeech`, `transcribe` graduated 🟢; `generateAudio` first-class on video | `experimental_*` | n/a yet |
| ❗ **Compaction** | **NOT in core.** No `compact()`/`compactWhen` on streamText/ToolLoopAgent. Only `HarnessAgent session.compact()` exists. | — | **Cherry must build its own compaction** (as our `C` layer planned) — SDK won't hand it to us on the ToolLoopAgent path |

**Loop-control primitive — detail (the #13570 "external loop control" plan only half-landed):** v7
decomposes `streamText` internally into two composable primitives but exports **only one**.
`experimental_streamLanguageModelCall` (public) runs **one** model call → a
`ReadableStream<LanguageModelStreamPart>` (text/reasoning deltas, tool-call, tool-result,
tool-approval-request/response, file parts, plus `model-call-start`/`model-call-end`/
`model-call-response-metadata`) — it deliberately emits **no** step/finish/abort framing, so the loop and
step bookkeeping are the caller's job. The matching tool-execution half, `executeToolsFromStream`, stays
**internal** (not exported). So "own the whole loop" = take the model-call primitive and re-implement tool
execution (approval/timeout/sandbox) yourself — net downside for Cherry vs. `stopWhen`+`prepareStep`.

## C. Security / execution — NEW packages

- ⭐ **`@ai-sdk/policy-opa`** 🟢 — policy-as-code tool gating via **OPA/Rego**, plugs into `toolApproval`. `opaPolicy({client, path, toInput?})` returns a `ToolApprovalConfiguration`. WASM (in-process) or HTTP (OPA server) backends. Verdicts: allow→approved, deny→denied, requires-approval→user-approval, else not-applicable. **Fails closed.** Has `shadow()` (audit-without-enforce) + transitive-enforcement guidance (gate `bash "git push"`). → A real, declarative `G` we could adopt instead of hand-rolling permission rules; in-process WASM fits Electron.
- **`@ai-sdk/sandbox-vercel`** 🧪 — `HarnessV1SandboxProvider` over Vercel Sandbox (ports, network policy). Cloud.
- **`@ai-sdk/sandbox-just-bash`** 🧪 — in-process virtual-FS bash sandbox, no ports. Works with the `pi` in-process harness; usable locally/Electron for a contained shell.
- Shared `SandboxSession` interface (`provider-utils/src/types/sandbox.ts`): `readTextFile/writeTextFile/spawn/run/...`. User tools receive a `restricted()` view as `experimental_sandbox`.

## D. Workflow / durable — `packages/workflow*`

- **`@ai-sdk/workflow` (WorkflowAgent)** 🟢 — superset-ish of ToolLoopAgent for durable contexts. **Runs standalone, no server** → usable in Electron, but input/output differ (`messages`+`writable` in, `WorkflowAgentStreamResult` out). Not needed unless we want durable resumable turns.
- **`@ai-sdk/workflow-harness`** 🟢 — slices long HarnessAgent turns to survive serverless recycling via JSON-serializable `HarnessWorkflowState`. **Requires Vercel Workflow DevKit (`'use workflow'`/`'use step'`) → NOT applicable to Electron.**

## E. Observability & tooling

- ⭐ **`@ai-sdk/otel`** 🟢 — telemetry **extracted from core into its own package**. Register via `registerTelemetry(new OpenTelemetry({tracer?, enrichSpan?}))`; per-call `telemetry:{functionId,isEnabled,recordInputs,recordOutputs}`. **Opt-out (on by default once registered).** GenAI semantic-convention spans (`gen_ai.*`); `LegacyOpenTelemetry` emits old `ai.*`. → Wire into Cherry's `src/main/ai/observability/` (where `buildTelemetry.ts` + the `aiSdkSpanAdapter` already live; not `packages/mcp-trace`); note default-on once registered.
- **`@ai-sdk/devtools`** 🧪 — local inspector. `registerTelemetry(DevToolsTelemetry())` → `npx @ai-sdk/devtools` (localhost:4983). Dev-only.
- **`@ai-sdk/tui`** 🟢 — `runAgentTUI({agent, ...})` full-screen terminal agent runner with tool cards/approvals. Reference UX for agent rendering, not a dep.
- **`@ai-sdk/mcp`** 🟢 — MCP client **now standalone**. `createMCPClient({transport})`; http/sse/stdio transports; tools + resources + prompts(🧪) + elicitation(🧪) + OAuth. → Cherry's MCP layer can lean on this instead of custom client glue.
- **`@ai-sdk/codemod`** 🟢 — **31 v7 codemods** (`npx @ai-sdk/codemod v7`): the renames in §B (`rename-full-stream-to-stream`, `rename-system-to-instructions`, `rename-on-step-finish-to-on-step-end`, `rename-experimental-telemetry-to-telemetry`, `rename-step-count-is`, `replace-image-message-part-with-file`, `replace-cached-input-tokens`, `replace-reasoning-tokens`, …). Covers the mechanical part of our upgrade.

## F. New providers (v7)
alibaba (Qwen + thinking), bytedance (Seedance video), baseten, klingai (video), moonshotai (kimi-k2 thinking), quiverai (SVG-gen), open-responses (generic Open-Responses endpoint), anthropic-aws (Claude on AWS, SigV4). Plus standalone `@ai-sdk/anthropic-aws`, `@ai-sdk/open-responses`.

## G. Structural refactors (not features — shape changes v6→v7)

These are architectural reshapes of the SDK itself, independent of any single API:

- **`streamText`/`generateText` decomposed into composable primitives** — internally split into
  `streamLanguageModelCall` (model call → parsed parts) + `executeToolsFromStream` (parts → tool exec).
  Only the first is public (`experimental_`). This is the engine behind "external loop control" (§B note).
- **Agent abstraction layered** — `Agent` interface (`generate`/`stream`, `version:'agent-v1'`) → concrete
  `ToolLoopAgent` / `WorkflowAgent` / `HarnessAgent`. v6 had `ToolLoopAgent`; v7 generalizes the interface
  so harness/workflow agents are swappable behind the same shape.
- **`CallSettings` split** → `LanguageModelCallOptions` + `RequestOptions` (timeout/transport separated from
  model-call params). Affects any code typed against `CallSettings` (Cherry: `runtime/aiSdk/loop` AgentOptions,
  `packages/aiCore/.../runtime/types.ts`). Codemod `rename-call-settings-type`.
- **Result object restructured** — final-step-only data moves under `result.finalStep` (`request`/`response`/
  `providerMetadata`/last-step `usage`); top-level `usage` now means all-steps total; `fullStream`→`stream`;
  `step.response.messages` stops accumulating. (The ⚠️ usage flip in §B is part of this.)
- **Telemetry extracted from core** → `@ai-sdk/otel` (was built-in OTel). Opt-out once registered. (§E)
- **MCP client extracted** → `@ai-sdk/mcp` (was embedded in `ai`). (§E)
- **Provider spec V4** — `@ai-sdk/provider` 3→4, every provider package a major bump; the per-provider
  request/response contract changed (this is what invalidates Cherry's 6 patches — see [`aisdk-v7-research.md`](./aisdk-v7-research.md)).
- **ESM-only** — CJS exports removed; Node ≥22 required.
- **Tool-result/message media unified** — `image-*`/`media`/`file-*` parts collapse to one `{type:'file'}`
  discriminated shape.

## Bottom line for Cherry
1. ⭐ The pieces that matter to our `(C,G)` runtime are **stable and mostly already in v6** on the ToolLoopAgent path we use: approval/`G` (v6 via `needsApproval` + the message-based request/response flow), `runtimeContext` (C carrier), `prepareStep`, `CALL_OPTIONS`/`prepareCall` (preset templating), end-to-end tool typing (`InferAgentUIMessage`), the lifecycle-callback family. **Strictly v7:** the centralized `toolApproval` setting, `toolsContext`/`contextSchema`, and the unified `reasoning` effort union.
2. **`policy-opa` is a legit declarative `G`** (in-process WASM works in Electron) — evaluate vs hand-rolling permission rules.
3. **Compaction is on us** — core SDK does not provide it on the ToolLoopAgent path; only HarnessAgent sessions get `compact()`. Matches our plan to build `C`-layer compaction.
4. **HarnessAgent / sandboxes / workflow-harness = not for us** (experimental wrapper of black-box CLIs, sandbox/server-bound).
5. Upgrade mechanics are largely codemod-able (31 codemods); real cost stays the 6 provider patches (v3→v4) + the ⚠️ silent `usage` semantics flip. See [`aisdk-v7-research.md`](./aisdk-v7-research.md).
