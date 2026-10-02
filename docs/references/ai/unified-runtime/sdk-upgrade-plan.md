---
description: Phase one AI SDK v6 to v7 implementation plan with dependency closure, codemod coverage, manual semantic migration, and acceptance gates
sources:
  - package.json
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - patches
  - packages/aiCore
  - packages/ai-sdk-provider
  - src/main/ai
  - src/renderer/services/aiTransport
---

# Phase 1 — Upgrade AI SDK Before Migrating Features

> Written 2026-10-02 against Cherry `1b799934263` (`ai@6.0.185`). Target assessment:
> `ai@7.0.123`, `@ai-sdk/codemod@4.0.3`. These are reproducible comparison versions, not a claim about
> the latest release. **Implementation, codemod execution, and runtime validation are not started.**

This is the first implementation phase of the [migration sequence](./migration-plan.md#implementation-sequence).
Its deliverable is Cherry running on v7 with its existing behavior preserved. Tool Search, Code Mode,
Harness, automatic stream retries, image Batch jobs, and new media features are subsequent work.

## 1.1 Freeze dependencies and reproduce the v6 baseline

1. Record the implementation branch's exact SHA, Node/pnpm/Electron versions, and resolved dependency
   graph. Run `pnpm install` with the repository-pinned toolchain before taking the baseline. Do not mix
   unrelated lockfile updates into the upgrade.
2. Inventory root and workspace dependencies, peers, overrides, patches, and bundler externalization.
   Include `packages/aiCore`, `packages/ai-sdk-provider`, `@ai-sdk/react`, direct provider/provider-utils
   imports, first-party providers, OpenRouter, Ollama, and GitHub Copilot. Classify each provider as
   native-v7, retained through a verified V2/V3 adapter, or blocked; record exact target versions and peers.
3. Check `pnpm-workspace.yaml` overrides which currently pin `ai`, provider, and provider-utils. Do not
   force a V4 provider-utils version into an older dependency merely to deduplicate it. Preserve error
   recognition across supported package boundaries and verify that no incompatible duplicate reaches
   shared execution code. V2/V3 model acceptance is not V4 feature support.
4. Record package export/engine impact. `@cherrystudio/ai-core` currently advertises CommonJS exports and
   Node >=18, while the selected SDK is ESM-only and Node >=22. Resolve the build/consumer contract and
   release-version implications explicitly; a desktop build cannot certify all workspace-package consumers.
5. Run the phase-1 baseline scenarios below on v6. Store failures as known baseline defects with an
   independent expected outcome; do not encode an existing bug as the desired v7 behavior.

**Exit:** reviewed version/peer table, a disposition for every relevant patch hunk, and reproducible
baseline outcomes. No feature migration starts merely because installation succeeds.

### Patch disposition record

Use the [current patch inventory](./aisdk-v7-research.md#audit-the-current-patches-not-the-june-count).
For each hunk record: protected behavior, source file, chosen version, upstream equivalent, reproduction,
remove/retain/reimplement decision, and test evidence. Initially all decisions are **unresolved**.

| Patch group | Concrete verification before removal |
|---|---|
| `ai@6.0.185` | Check URL/data-URL image handling and custom downloader independently from UI snapshot copying; preserve cancellation, proxy/auth behavior, and nested snapshot isolation |
| `@ai-sdk/react@3.0.187` | Long streaming response remains responsive; previous UI snapshots do not mutate when nested tool inputs/metadata update |
| Anthropic, OpenAI, Google, OpenAI-compatible, Open Responses | Replay exact affected wire payloads and inspect mapped reasoning, tools, media, usage, and errors; dispose of each hunk independently |
| OpenRouter, Ollama, GitHub Copilot | Verify their selected versions and peers, protocol mapping, and applicable Cherry modifications; package installation is insufficient |
| Native Claude/Pi/DSH patches | Record as native-runtime dependencies; revisit during Harness adoption if its adapter introduces a different SDK version |

The full patch contents are the authority. This table groups work; it does not preapprove deleting patches.

## 1.2 Apply codemods within the dependency upgrade

The inspected official bundle contains **32 v7 transforms**. The tables below cover all of them.
Names are suffixes under `v7/`. “Candidate” means a matching current source surface, not a dry-run result.
“No direct use found” refers to a static production-source scan; tests, examples, aliases, and generated
outputs still need classification. No codemod has been run for this document.

Use a clean, disposable checkout of the implementation SHA. First inspect the pinned tool's `--help`.
The official full-bundle preview and a scoped example are:

```bash
pnpm dlx @ai-sdk/codemod@4.0.3 v7 --dry
pnpm dlx @ai-sdk/codemod@4.0.3 v7/rename-step-count-is src/main/ai/runtime/aiSdk --dry --print
```

Run the reviewed individual transform without `--dry` to apply it. Repeat for the relevant workspace
and test paths. Save commands and diffs with the implementation record. The full bundle operates from
its working directory, so run it only in the disposable checkout, not over `.context` research snapshots.
A dry-run bundle does not cumulatively apply earlier transformations; inspect the actual staged result too.
Use `v7`, not the all-major `upgrade` command. Dependency/peer/patch selection remains a separate task.

Some transforms are broad AST rewrites rather than import-aware migrations: the checked
`rename-on-finish-to-on-end` rewrites object keys named `onFinish`, and the context transform rewrites
member access/destructuring without wiring new context providers. Review each diff; preserve unrelated
Cherry/React/native-SDK contracts and generated data mappings. Do not blanket-rename application fields.

### Mostly mechanical transformations

| Codemod | Current candidate / disposition | Verification after applying |
|---|---|---|
| `rename-step-count-is` | `loop/types.ts`, `loop/toolLoopTermination.ts`, `params/buildAgentParams.ts` | Same stop conditions and terminal outcome |
| `rename-call-settings-type` | `runtime/aiSdk/loop/types.ts`; `Agent.ts` mentions the old type in a comment | Split into `LanguageModelCallOptions` and request options without inventing timeout behavior |
| `remove-experimental-custom-provider` | No direct use found | Scan wrapper exports and fixtures |
| `remove-experimental-generate-image` | No direct use found; existing `generateImage` still needs semantic tests | Stable export/type and image result compatibility |
| `replace-experimental-output-with-output` | No direct use found | Structured-output options and result readers |
| `remove-experimental-prepare-step` | No direct use found; existing `prepareStep` is active | No obsolete aliases remain |
| `remove-experimental-active-tools` | No direct use found; existing `activeTools` is active | Tool selection preserved |
| `remove-tool-call-options-type` | No direct use found | Actual `ToolExecutionOptions` import owner/type |
| `remove-is-tool-or-dynamic-tool-uipart` | No direct use found | Existing tool-part guards still cover dynamic tools |
| `rename-experimental-transcribe` | No direct use found | Media wrapper/export audit |
| `rename-experimental-generate-speech` | No direct use found | Media wrapper/export audit |
| `rename-google-generative-ai-to-google` | Scan Google imports and public aliases | Selected provider types and workspace exports |

### Automated edits that require semantic work

| Codemod | Current candidate / disposition | Work the codemod cannot complete |
|---|---|---|
| `rename-system-to-instructions` | `Agent`, ai-core executor, prompt/repair callers | Preserve trust/precedence and step-to-step instruction lifetime; do not rename the application's stored system-prompt field |
| `rename-on-finish-to-on-end` | Agent hooks/analytics plus unrelated stream/UI callbacks | Adapt the v7 aggregate result payload and error/abort behavior; retain non-SDK callback names |
| `rename-on-step-finish-to-on-step-end` | Agent, `loop/types.ts`, `composeHooks.ts`, usage observer, analytics | Remove duplicate synthesis only after native callbacks are wired and attribution is verified |
| `rename-experimental-on-start-to-on-start` | No direct use found | Cherry currently synthesizes hooks; add native wiring manually |
| `rename-experimental-on-step-start-to-on-step-start` | No direct use found | Same native-hook wiring and ordering audit |
| `rename-experimental-on-finish-to-on-end` | No direct use found | Distinguish embed result/event semantics if introduced by dependencies |
| `rename-experimental-on-tool-call-start-to-on-tool-execution-start` | No direct use found | Replace `wrapToolsWithExecutionHooks` behavior manually, preserving parent call identity |
| `rename-experimental-on-tool-call-finish-to-on-tool-execution-end` | No direct use found | Verify failure/cancellation and exactly one execution-end observation |
| `rename-experimental-telemetry-to-telemetry` | `runtime/aiSdk/Agent.ts` | Add/configure `@ai-sdk/otel`; replace custom tracer wiring without enabling global telemetry |
| `rename-on-rerank-finish-to-on-rerank-end` | No direct use found | Check telemetry integrations if used |
| `rename-on-embed-finish-to-on-embed-end` | No direct use found | Check telemetry integrations if used |
| `rename-full-stream-to-stream` | Gateway SSE adapters contain `fullStream` identifiers | Trace ownership: local parameter names are not automatically removed SDK properties |
| `move-include-raw-chunks-to-include` | No direct use found | Decide required raw/debug body inclusion explicitly |
| `rename-experimental-include-to-include` | No direct use found | v7 omits request/response bodies by default |
| `rename-experimental-context-to-context` | Tool context helpers, approval gate, meta invoke/exec, `Agent.ts` | Split shared `runtimeContext` from per-tool `toolsContext`/`contextSchema`; a rename alone loses request data |
| `replace-cached-input-tokens` | `usageNormalize.ts`, `aiSdkSpanAdapter.ts` | Distinguish SDK usage from legacy/native envelopes and telemetry attribute names |
| `replace-reasoning-tokens` | SDK consumers plus DB/shared/native fields named `reasoningTokens` | Change SDK reads only; preserve persisted/UI contracts and aggregate correctly |
| `replace-anthropic-cache-creation-input-tokens` | No exact production field use found | Audit snake-case/native metadata and cache-read/write accounting |
| `remove-media-content-part-type` | Classify matching content discriminants by owning protocol | Do not rewrite MCP/native media envelopes as AI SDK parts |
| `replace-image-message-part-with-file` | `messages/messageRules.ts`, media routing, ai-core context | Preserve bytes, URLs, media type, historical messages, and model capability routing |

Sources: [fixed migration guide](https://github.com/vercel/ai/blob/ai%407.0.123/content/docs/08-migration-guides/23-migration-guide-7-0.mdx),
[actual v7 bundle](https://github.com/vercel/ai/blob/ai%407.0.123/packages/codemod/src/lib/upgrade.ts),
[context transform](https://github.com/vercel/ai/blob/ai%407.0.123/packages/codemod/src/codemods/v7/rename-experimental-context-to-context.ts).

## 1.3 Complete the manual semantic migration

| Boundary / code owner | Required implementation | Acceptance evidence |
|---|---|---|
| `packages/aiCore/src/core/runtime/executor.ts`, `core/agents/createAgent.ts`, provider packages | Upgrade resolved contracts/peers and forward v7 options through public wrappers; maintain older-provider adapters only where proven | Native and compatible endpoints plus workspace consumers load and execute |
| `runtime/aiSdk/Agent.ts`, `loop/types.ts`, `loop/hookRunner.ts`, `params/composeHooks.ts` | Wire native lifecycle callbacks; keep fan-in; remove only duplicated wrapper synthesis; update stream/UI helpers | Normal, error, approval-pause, abort, and multi-step terminal cases emit the intended lifecycle once |
| `tools/adapters/aiSdk/context.ts`, `buildAgentParams.ts`, built-ins/MCP/meta-tools | Put host orchestration state in `runtimeContext`; explicitly provide each tool's declared context and preserve nested forwarding | Request/session/knowledge/provenance values reach only the intended tools, including repair and nested calls |
| `messages/messageRules.ts`, `messageCapabilities.ts`, ai-core context | Adapt image/file/reasoning-file parts and step response-message accumulation; keep history valid | Reload older messages, file/URL inputs, reasoning, tool-pairing, and compaction without loss |
| `params/assembleSystemPrompt.ts`, prompt features and repair | Use `instructions`; opt into `allowSystemInMessages` only for trusted history where necessary; account for carried-forward `prepareStep` overrides | No lost/reset persona or promoted user-controlled system instruction across steps |
| `observers/usage.ts`, `utils/usageNormalize.ts`, usage persistence and gateway adapters | Separate aggregate `usage` from `finalStep`; adapt result/metadata reads | Two-step totals equal individual invocations with no double-counted billing or lost cache/reasoning tokens |
| Approval host and tool adapters | Migrate `needsApproval` policy to core `toolApproval` where appropriate; preserve Main authority, schema-transformed inputs, and continuation identity | Denial causes no effect; valid approval resumes the intended call once; stale/cross-session decisions fail |
| `buildTelemetry.ts`, `observability/adapters/aiSdk/aiSdkSpanAdapter.ts` | Use per-call OTel integration and map new attributes; retain developer-mode opt-in and parent spans | Disabled tracing emits no spans; enabled tracing attributes tool/model attempts to their owner |
| Provider construction and `retry/` | Preserve endpoint family, unify reasoning options without conflicting legacy provider fields, retain failover/error classification, and audit xAI Responses-default changes | Existing chosen endpoints and retry semantics remain explicit; v7 `streamRetries` stays off in this phase |
| `src/renderer/services/aiTransport`, stream persistence, Gateway SSE | Adapt v7 UI stream surface without changing transport ownership | Partial reasoning/tool input, disconnect/reconnect, approval, cancellation, and restored transcripts render consistently |
| Electron build and workspace exports | Resolve ESM externalization and actual embedded Node support | Development and packaged app load SDK/providers; exported package consumer smoke passes |

`generateImage` remains a wait-for-result API. Cover the current image downloader, editing inputs,
capability unknown/false handling, cancellation, and saved artifacts as regression cases. Async image
Batch is separate: [official Batch](https://ai-sdk.dev/docs/ai-sdk-core/batch) exposes serialized job
references and provider/model-specific support (the inspected table lists Google and xAI for images).
Do not add job persistence, polling, cancellation UI, or recovery as a side effect of upgrading the SDK.

## 1.4 Verification and exit gate

Run real SDK/provider packages against a controlled HTTP protocol server where supported. The server
scripts model responses/errors; it must not replace the SDK with preconstructed internal events. Combine
that with real-provider smoke and packaged Electron runs. At minimum record:

| ID | Scenario | Required observable result |
|---|---|---|
| SDK-01 | Text/reasoning, structured output, two tool steps | Correct final answer/artifacts, ordered durable messages, one terminal outcome |
| SDK-02 | Missing context, schema defaults/transforms, approval allow/deny | Correct validated input and context; denied or misattributed calls create no effect |
| SDK-03 | Stop, provider error, partial stream disconnect, model/key fallback | Existing terminal/retry behavior preserved; no duplicated committed tool effect |
| SDK-04 | Reload v6-created messages with media and tool outputs | History readable; tool/result pairs and partial UI parts remain coherent |
| SDK-05 | Multi-step usage/cache/reasoning, tracing on/off | Per-invocation and aggregate accounting agree; opt-out respected |
| SDK-06 | Image generation/edit/download, embed and rerank | Existing capability and provider paths still work; artifacts/usage/errors mapped correctly |
| SDK-07 | Large streaming response and mutable nested parts | No snapshot aliasing; latency/memory measured against the pinned baseline with agreed budgets |
| SDK-08 | Production package startup and workspace exports | ESM/native loading works on supported packaged targets; no accidental environment dependency |

Use existing suites as entry points: `loop/__tests__/agentLoop.test.ts`, `toolLoopTermination.test.ts`,
`params/__tests__/buildAgentParams.test.ts`, message-rule tests, usage/observability tests, and ai-core
runtime/context/provider tests. Add contract cases where missing; mocked unit coverage supplements the
black-box gate. No new test runner or dedicated command is presumed to exist.

Implementation checks: `pnpm lint`, affected `pnpm test:main <file>`, `pnpm test:aicore <file>` and
`pnpm test:renderer <file>` suites; the full `pnpm test` is appropriate for this cross-cutting upgrade.
Run `pnpm docs:check` for accompanying docs. Record real-provider and packaged results separately from
unit/CI success; use the repository Electron test workflows for app validation.

**Exit:** compatible dependency closure, all patch decisions evidenced, codemod diffs reviewed, manual
contract work complete, and SDK-01–08 passed for the declared support matrix. Tool Search / Code Mode /
Harness replacements cannot merge past this gate with unresolved SDK regressions.

Deliver in reviewable commits: dependency/patch and codemod changes, manual contract repairs, then
black-box/packaging evidence. The resulting PR must be complete and green; intermediate commits are not
independent release candidates. Roll back by reverting the complete coherent upgrade change set. This
phase must not rewrite shipped database migrations or require deleting user data.
