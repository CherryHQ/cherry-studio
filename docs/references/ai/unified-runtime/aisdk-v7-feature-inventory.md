---
description: AI SDK v7 feature deltas through 7.0.127, separately pinned main changes, and Cherry migration dispositions
sources:
  - src/main/ai
  - package.json
---

# AI SDK v7 — Feature Delta Inventory

> Refreshed 2026-10-04 through published **`ai@7.0.127`**, comparing with **`7.0.0`**.
> Main-only observations use **`15f1a4d0531ac641a4a4d9cc602c0536c1906834`** and are separated below.
> Published package versions do not imply every API is stable. Experimental surfaces are identified below.
> The [June inventory](https://github.com/CherryHQ/cherry-studio/blob/e51a3ad0643e6d15e76b7720b8739e4fb4f77c6b/docs/references/ai/unified-runtime/aisdk-v7-feature-inventory.md) is retained in Git history.

## Core and tool execution

| Area | First relevant release | Current capability and limits | Cherry implication |
|---|---|---|---|
| Code Mode | `7.0.43`; stream/Agent support in `7.0.45` | `@ai-sdk/code-mode` executes JS / type-stripped TS in QuickJS; `experimental_toolCallers` controls routing. Experimental, Node ≥22, not browser/edge | Evaluate tool composition, parallel execution, and result filtering independently of runtime replacement |
| Conversation tool catalogs | `7.0.103` | `toolDiscovery: 'conversation'` updates tool catalogs through messages while keeping the code tool definition stable; actual prompt-cache reuse depends on the provider | Compare with current deferred-tool prompt/catalog changes |
| Native tool search | `7.0.104`; configurable search/limit in `7.0.127` | `toolSearch({ search, maxResults })` + `deferLoading`; default limit 5, custom sync/async ranking over eligible tools, matches available next model step | Evaluate callback reuse for Cherry ranking; namespace/browsing/schema differences remain; TS-01–09 |
| Streaming errors / recovery | `7.0.80` / `7.0.91` | `StreamProviderError` preserves provider metadata; opt-in `streamRetries` retries a failed model step after streaming has begun | Align with existing retry/fallback policy; not equivalent to reconnect or cross-model fallback |
| Approval continuation | `7.0.82`, `7.0.84–86`, later fixes | Request reasons, Agent approval-secret configuration, WorkflowAgent signed approvals, and schema-transform-safe resumed inputs | Audit persistence, displayed reasons, and revalidation; do not treat signed approval as application authorization |
| Structured output | `7.0.93`, `7.0.106` | Array `minItems` / `maxItems`; fixes for structured output from the final tool-loop step | Recheck validation and final-result extraction |

Sources: [Code Mode](https://ai-sdk.dev/docs/ai-sdk-core/code-mode),
[Tool Search](https://ai-sdk.dev/docs/ai-sdk-core/tool-search),
[error handling](https://ai-sdk.dev/docs/ai-sdk-core/error-handling),
[fixed release history](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/CHANGELOG.md).

### Execution boundaries

**Approval correction (2026-10-02):** the live Code Mode guide says nested approvals cannot pause,
but the published `@ai-sdk/code-mode@1.0.80` API includes approval callbacks, interrupt/continue helpers,
and signed replay state (introduced in `1.0.7`). This requires explicit host integration; it is not
proof of automatic Core/Harness/Cherry approval parity. Keep gated tools direct in the initial Core
adoption and verify Pi's existing nested approvals before replacement. See the
[package evidence and implementation plan](./tool-discovery-plan.md#31-resolve-the-approval-contract-from-the-published-package).

**Stream retries isolate failed tool attempts, not already-visible output.** Earlier completed steps are
not replayed. Failed-attempt client-side tool calls and approval requests are withheld until a successful
model-call finish. Text/reasoning/files already emitted cannot be retracted, so users may see duplicated
or divergent partial output. Provider-executed effects cannot be undone. These semantics affect both UI
projection and retry safety. Recovery is disabled unless `streamRetries` is explicitly configured.

## Files, media, and evaluation

| Area | First relevant release | Additions | Status / boundary |
|---|---|---|---|
| FilesV4 lifecycle | `7.0.89` | Optional metadata, streaming download, delete, stream upload, cancellation/headers, size/creation/expiry metadata | Provider-dependent; replaces the old upload-only assessment |
| Provider skill upload | v7 baseline; already exported in `7.0.123` | `uploadSkill` / `SkillsV4` uploads a file set and returns provider reference/version metadata | Separate from FilesV4 and local/Harness skills; only upload is standardized; S decision pending, S-01–03 if adopted |
| Batch | `7.0.55` | Later adds webhook (`.79`), tools (`.88`), per-request models (`.94`), cancel/list (`.96–97`), images (`.98`) | Experimental `startBatch/getBatchStatus/getBatchResults/cancelBatch/listBatches`; provider capabilities differ |
| Evaluation | `7.0.103`; telemetry `.111` | `experimental_evaluate` with typed Choice/Score/Boolean questions over shared state | Experimental; not a replacement for an application evaluation dataset or test harness |
| Streaming transcription / translation | `7.0.14` / `7.0.38` | Streaming speech input and speech-to-speech translation APIs | Experimental; provider/model-specific |
| Asynchronous video | `7.0.50`; explicit start/status `.75` | Poll/webhook completion, fire-and-forget start/status; image and video references | Experimental; cancellation, task persistence, and provider capabilities need application handling |
| Realtime Live | `7.0.102` | Client-delegated Live sessions, WebSocket relay and browser-direct WebRTC paths, bounded queues and connection lifecycle | Experimental; application owns agent/tool execution and context submission |
| Image capabilities | `7.0.119` | File/mask input support declarations on image models | Unknown models can report unknown support; do not convert unknown to supported |
| Compatible multipart tool results | `@ai-sdk/openai-compatible@3.0.62` | `supportsMultiPartToolContent`, off by default, permits array tool-message content | Endpoint-specific retain/adopt decision; preserve existing message conversion unless verified; I6/I-09 |
| Speech/transcription telemetry and usage | `ai@7.0.124` | Operation-specific lifecycle callbacks and provider usage, including experimental streaming callbacks | M2/M-02 must preserve invocation attribution, terminal state, units and tracing opt-out if adopted |

Sources: [file lifecycle release](https://github.com/vercel/ai/releases/tag/ai%407.0.89),
[Batch](https://ai-sdk.dev/docs/ai-sdk-core/batch),
[Evaluation](https://ai-sdk.dev/docs/reference/ai-sdk-core/evaluate),
[Realtime](https://ai-sdk.dev/docs/ai-sdk-core/realtime),
[provider changes](https://github.com/vercel/ai/blob/ai%407.0.123/packages/provider/CHANGELOG.md),
[skill upload](https://github.com/vercel/ai/blob/ai%407.0.123/packages/ai/src/upload-skill/upload-skill.ts),
[multipart option](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/packages/openai-compatible/src/openai-compatible-provider.ts#L94),
and the release ledger below.

## Harness evolution

Harness packages remain experimental. Versions below refer to `@ai-sdk/harness`, not `ai`.

| Change | Version | Boundary |
|---|---|---|
| Caller-owned sandbox sessions | `1.0.76` | Pass an existing `sandboxSession`; session stop/destroy does not destroy the caller-owned sandbox |
| Mid-turn steering | `1.0.78` | Experimental, adapter-dependent; not a universal abort+restart contract |
| Per-turn model and settings | `1.0.93–94` | Shared model selection and `prepareCall` reduce adapter-specific configuration |
| Questions and callbacks | `1.0.101–102` | Normalized `askUserQuestions`, lifecycle callback parity, headers |
| Adapter-native authentication | `1.0.108` | Native subscriptions where supported; credential handling remains adapter-dependent |
| Sandbox API separation | `1.0.126` | Separates sandbox lifecycle/template/snapshot concerns from Harness configuration |
| Normalized history contract | `1.0.133` | `readHistory({ since })` contract exists; the fixed release capability table marks history access unsupported for all built-in adapters |

The adapter catalog now includes Claude Code, Codex, Pi, OpenCode, Cline, Cursor, Deep Agents, fx,
GitHub Copilot, and Grok Build, plus an ACP integration surface. Pi/Cline run in the host process;
bridge and ACP adapters have different execution and sandbox requirements. Built-in approval, filtering,
structured output, and history are not interchangeable across adapters.

Sources: [Harness changelog](https://github.com/vercel/ai/blob/ai%407.0.123/packages/harness/CHANGELOG.md),
[HarnessAgent](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent),
[fixed adapter capability table](https://github.com/vercel/ai/blob/ai%407.0.123/content/docs/03-ai-sdk-harnesses/05-harness-adapters.mdx).

## Reliability and structural changes

- `7.0.65`: avoid repeatedly deep-copying accumulated text in `readUIMessageStream`, while retaining
  independent snapshots of mutable nested values. Compare with both Cherry snapshot patches.
- `7.0.120–121`: preserve active UI parts, partial static-tool inputs, and metadata across stream resumptions.
- `7.0.123`: optional SSE heartbeats and fixes around obsolete pending approvals and reasoning tags.
- `7.0.116` / `7.0.123`: package build target becomes ES2022; build tooling moves from tsup to tsdown.
  These do not themselves prove compatibility with an Electron bundle.

Source: [published core changelog](https://github.com/vercel/ai/blob/ai%407.0.123/packages/ai/CHANGELOG.md).

## Release and main delta ledger

This refresh separates published versions from pending changesets at the pinned main SHA. A workspace
package version is not evidence that the source beside it has shipped. Re-resolve versions and peers
before implementation; do not install main implicitly to obtain a pending fix.

| Availability | Delta and fixed evidence | Migration / acceptance record |
|---|---|---|
| Released `ai@7.0.124` | [Speech/transcription telemetry and provider usage](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/CHANGELOG.md#70124) | Conditional M2/M-02, distinct callbacks and usage units |
| Released `ai@7.0.125` | [Agent UI helpers accept `convertDataPart`](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/CHANGELOG.md#70125) | R1/SDK-04: record whether current data parts need conversion; preserve typed parts through history/model-input conversion |
| Released `ai@7.0.126–127` | [Stale approval cleanup, cross-realm equal inputs, merged-stream cancellation and configurable Tool Search](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/CHANGELOG.md) | SDK-02/03/04, R-01/06/07 and TS-09; include readers merged after cancellation |
| Released `@ai-sdk/openai-compatible@3.0.62` | [Multipart tool outputs](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/packages/openai-compatible/CHANGELOG.md#3062) | I6/I-09 endpoint decision; dependency upgrade alone does not enable it |
| Released `@ai-sdk/harness-acp@1.0.77` | [Host-tool relay matches the approved tool and input](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/packages/harness-acp/CHANGELOG.md#1077) | Harness approval gate if ACP is selected; reject mismatched, reused and stale authorization |
| Main-only, `ai` | [Preserve approval state during stream resume](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/.changeset/calm-tools-resume.md) | R-06: resumed approval state versus a genuinely new message; pin a later release/fix if reproduction requires it |
| Main-only, Harness | [Settle terminal telemetry on error and abort](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/.changeset/honest-beans-wait.md) | H1: one terminal event with correct call identity and error/abort classification |
| Main-only, Harness Claude Code | [Use latest cumulative cost instead of summing cumulative results](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/.changeset/tidy-claude-cumulative-cost.md) | H3: multiple results and resumed-session prior cost; session cumulative cost is not per-invocation usage |

The current Harness Pi dependency set still uses `pi-ai@0.74.2`, `pi-coding-agent@^0.85.1` and
`pi-mcp-adapter@2.12.1`, while Cherry uses Pi `1.0.0` with native MCP/Code Mode and pi-vcc `0.8.1`.
This is a compatibility task, not proof the adapter cannot work. See the
[H2 mapping and remaining Harness gaps](./migration-plan.md#phase-4-implementation-slices).

## Existing v7 baseline, not new since June

`runtimeContext`, `toolsContext`, centralized `toolApproval`, unified reasoning, the `usage` / `finalStep`
change, stateless UI-stream helpers, separate OTel integration, basic HarnessAgent, and file upload were
already part of the v7 baseline. They remain migration work, not newly discovered benefits.

The SDK still exposes `experimental_streamLanguageModelCall`, while `executeToolsFromStream` is internal.
Owning a custom loop therefore still means owning tool-execution semantics. Top-level ToolLoopAgent
compaction remains an [open proposal](https://github.com/vercel/ai/issues/14017); Cherry already has its
own compaction implementation. Neither issue examples nor provider-native compaction establish a
published generic compaction API.

See the [upgrade assessment](./aisdk-v7-research.md) and
[research coverage matrix](./migration-plan.md#research-coverage) for every row's migration/adoption
disposition and acceptance. The [file lifecycle plan](./large-file-upload-port.md) and
[image, recovery and media plan](./capability-migration-plan.md) carry the work beyond the tool/runtime branch.
