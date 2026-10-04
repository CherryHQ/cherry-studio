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

> Refreshed 2026-10-04 against Cherry `e3052500309` (`ai@6.0.185`). Published target comparison:
> `ai@7.0.127`. The codemod inventory remains pinned to `@ai-sdk/codemod@4.0.3`; choose and inspect the
> actual implementation dependency closure before applying it. [Main-only fixes](./aisdk-v7-research.md#released-versus-main-only-changes)
> are not included merely by selecting that release. This page defines the compatibility gate;
> [PR #21310](https://github.com/CherryHQ/cherry-studio/pull/21310) owns the implementation and observed validation.

This is the first implementation phase of the [migration sequence](./migration-plan.md#implementation-sequence).
Its deliverable is Cherry running on v7 with its existing behavior preserved. Tool Search, Code Mode,
Harness, FilesV4 upload adoption, automatic stream retries, image Batch jobs, and new media features are
subsequent work. Existing attachments, image generation/editing, custom image jobs, embedding/rerank,
structured output, compaction and UI streams are part of this upgrade, not optional follow-ups.

## Implementation record — 2026-10-04

The implementation is [PR #21310](https://github.com/CherryHQ/cherry-studio/pull/21310),
stacked on the research and plans in [PR #16462](https://github.com/CherryHQ/cherry-studio/pull/16462).
The earlier merge of Cherry main is retained. AI SDK source inspection uses main
`15f1a4d0531ac641a4a4d9cc602c0536c1906834`; installed dependencies use published versions.

### Dependency and protocol closure

| Package group | Selected versions / protocol |
|---|---|
| Core | `ai@7.0.127`, provider `4.0.21`, provider-utils `5.0.53`, React adapter `4.0.130` |
| Integration | OTel `1.0.127`, devtools `1.0.30`, ai-retry `2.7.0` |
| OpenAI family | OpenAI `4.0.83`, Azure `4.0.90`, compatible `3.0.62`, Open Responses `2.0.58` — native V4 |
| Anthropic / Google | Anthropic `4.0.71`, Google `4.0.87`, Vertex `5.0.101`, Bedrock `5.0.105` — native V4 |
| Other official providers | Gateway `4.0.103`, Bytedance `2.0.56`, Cerebras `3.0.62`, Cohere `4.0.54`, DeepSeek `3.0.58`, Groq `4.0.54`, Hugging Face `2.0.62`, Mistral `4.0.56`, Perplexity `5.0.5`, Together `3.0.63`, xAI `4.0.59` — native V4 |
| Community providers | OpenRouter `3.1.0`, Ollama `4.0.1` — native V4 |
| Explicit exception | GitHub Copilot `1.0.0` has no published V4 replacement in this inventory. Retain its V3 provider `3.0.18`, utils `4.0.56`, compatible `2.0.72`; the SDK converts at the execution boundary |
| Cherry providers | Custom providers and `@cherrystudio/ai-sdk-provider` expose V4, including image, embedding, rerank, speech and transcription contracts |
| Workspace exports | AI Core and AI SDK Provider publish ESM only and require Node >=22; their changeset records the public breaking changes |

xAI is pinned to the latest V4-protocol 4.x provider: 5.x removes Chat Completions. The base extension
explicitly uses `chat`, while `xai-responses` continues to use Responses, preserving saved endpoint choices.

The core executor and middleware use V4. Its public wrappers accept native V4 models and the previous
V3 model inputs. This does not advertise V4 feature parity for Copilot. No new FilesV4 lifecycle or
provider-reference upload path is enabled as part of this compatibility boundary.

### Patch decisions

| Previous patch | Decision and protected behavior | Regression evidence |
|---|---|---|
| Core `ai@6.0.185` image hunks | Reimplement for `7.0.127`: HTTP/data URLs, custom downloads, cancellation, returned bytes | `generateImageDownloadPatch.test.ts`; ai-core image generation/editing tests |
| Core and React snapshot hunks | Remove: v7 performs selective immutable snapshot copying upstream | `aiSdkV7.test.ts`: retained snapshots across nested tool input/metadata changes and 1000 text chunks |
| Anthropic | Reimplement: optional thinking signature, unknown gateway model token limits, internal tool-schema sanitization and explicit `additionalProperties` | `anthropic.maxOutputTokens`, `anthropic.sonnet55`, `aihubmix.anthropicTools` boundary tests |
| OpenAI | Reimplement: correct reasoning-model sampling guard, image URLs, strict Responses message/item IDs, opted-in raw reasoning replay/deltas, nullable output annotations | `openaiResponses*Patch`, `openaiResponsesItemId`, image download tests |
| Google | Reimplement model-path/prefix compatibility; backport Imagen `/predict` into V4 while retaining native Gemini generation/editing | `googleImagePatch.test.ts`: Imagen parameters and images, Gemini input images, unsupported edits; AiHubMix image tests |
| OpenAI-compatible | Reimplement native V4: reasoning replay including empty turns, tagged image output, embedding usage fallback, image URL replies and implicit response-format retry | Compatible image tests; AiHubMix/DMX/Silicon boundary tests |
| Compatible `2.0.72` and Copilot | Retain only for Copilot's V3 dependency boundary | `copilotEndpointPatch.test.ts`: CJS/ESM request routing through SDK V4 adaptation |
| Open Responses | Remove: `2.0.58` already replays reasoning content and uses the active reasoning-part identity | `openResponsesPatch.test.ts` |
| OpenRouter | Reimplement strict JSON schema, search domain options, web fetch, image MIME and URL/base64 handling | `aiSdkToolMetadata`, provider-options tests and OpenRouter reasoning tests |
| Ollama | Reimplement thinking levels/omission, nested sampling options, image-only input and reasoning-before-text stream order | `ollama.chatReasoning.test.ts` |

### Semantic migration and evidence

- Tool execution reads schema-scoped `context`; the agent supplies `toolsContext`, with shared orchestration
  in `runtimeContext`. Existing host approval remains authoritative. Native SDK tool callbacks replace the
  execute wrapper and include asynchronous preliminary results. Cherry's observer hook names remain stable.
- Agent generation returns `finalStep.text`; aggregate usage remains aggregate. OTel is configured per call
  using the official integration and Cherry's tracer; disabled tracing stays disabled.
- Reasoning remains on the existing registry/provider-option path. The chat agent does not yet expose
  top-level `reasoning`; [RG-01–06](./migration-plan.md#unified-reasoning-adoption) tracks that adoption
  separately, including precedence, budget differences and output/replay retention.
- Canonical V4 files and reasoning files retain media accounting and tool-image routing. Inline text files
  count toward compaction; historical error-only messages retain their turn boundary during UI conversion.
- Retry tests preserve key rotation after exhausted transient attempts; the finite key list bounds failover.
  SDK stream recovery remains disabled during this baseline upgrade.
- Executed codemod: `@ai-sdk/codemod@4.0.3 v7/rename-step-count-is src/main/ai`. The remaining inventory below
  was audited and migrated manually where applicable; the full codemod bundle was not executed.
- V6 baseline: 534 ai-core tests and 82 selected main tests passed. The v7 full run covered all 12 Vitest
  projects: 33,939 passed, 68 skipped, and one newly added xAI fixture failed because it omitted the required
  `object: 'response'` field. After correcting that fixture, all three tests in its file passed on rerun;
  the full suite was not repeated. No other test failures or unhandled errors were reported.
- Frozen installation, all six typecheck targets, i18n, repository checks and the docs gate passed. Lint
  passed with zero errors and 43 existing ESLint warnings using `pnpm lint --ignore-pattern '.context/**'`;
  the unfiltered aggregate command also linted ignored research/vendor scratch files and failed there.
- Production Electron main/preload/renderer and utility-process builds passed. Both workspace packages
  were packed and installed outside the monorepo; all four public ESM entrypoints and a real SDK request
  passed on Node 22.0.0 and 24.21.0. Electron 44.2.0 started with the existing development profile and rendered
  its main window; the attached renderer reported no page errors during the smoke check. Configured MCP
  services with expired endpoints or an unavailable demo implementation still reported startup errors.
- Controlled HTTP/fetch fixtures execute the real SDK and providers, including six Imagen/Gemini image
  compatibility cases. Real-account file uploads, generation/editing, provider-native tools, and the
  packaged OS matrix remain manual validation items; latency/memory budgets were not benchmarked.

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
4. Record package export/engine impact. `@cherrystudio/ai-core` at the v6 baseline advertises CommonJS exports and
   Node >=18, while the selected SDK is ESM-only and Node >=22. Resolve the build/consumer contract and
   release-version implications explicitly; a desktop build cannot certify all workspace-package consumers.
5. Run the phase-1 baseline scenarios below on v6. Store failures as known baseline defects with an
   independent expected outcome; do not encode an existing bug as the desired v7 behavior.

**Exit:** reviewed version/peer table, a disposition for every relevant patch hunk, and reproducible
baseline outcomes. No feature migration starts merely because installation succeeds.

### Patch disposition record

Inventory the actual patched dependencies in `pnpm-workspace.yaml` and `patches/`.
For each hunk record: protected behavior, source file, chosen version, upstream equivalent, reproduction,
remove/retain/reimplement decision, and test evidence. The implementation PR records the chosen dispositions.

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
outputs still need classification. This is the planning inventory; the executed transform is recorded above.

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
| OpenAI-compatible provider settings and `messageCapabilities.ts` | Preserve current tool-media conversion during the baseline; record per-endpoint disposition for the new multipart flag | SDK-04 preserves current media; optional I6/I-09 tests actual array tool content and fallback before enabling it |
| `params/assembleSystemPrompt.ts`, prompt features and repair | Use `instructions`; opt into `allowSystemInMessages` only for trusted history where necessary; account for carried-forward `prepareStep` overrides | No lost/reset persona or promoted user-controlled system instruction across steps |
| `observers/usage.ts`, `utils/usageNormalize.ts`, usage persistence and gateway adapters | Separate aggregate `usage` from `finalStep`; adapt result/metadata reads | Two-step totals equal individual invocations with no double-counted billing or lost cache/reasoning tokens |
| Approval host and tool adapters | Migrate `needsApproval` policy to core `toolApproval` where appropriate; preserve Main authority, schema-transformed inputs, and continuation identity | Denial causes no effect; valid approval resumes the intended call once; stale/cross-session decisions fail |
| `buildTelemetry.ts`, `observability/adapters/aiSdk/aiSdkSpanAdapter.ts` | Use per-call OTel integration and map new attributes; retain developer-mode opt-in and parent spans | Disabled tracing emits no spans; enabled tracing attributes tool/model attempts to their owner |
| Provider construction and `retry/` | Preserve endpoint family, unify reasoning options without conflicting legacy provider fields, retain failover/error classification, and audit xAI Responses-default changes | Existing chosen endpoints and retry semantics remain explicit; v7 `streamRetries` stays off in this phase |
| `messages/attachmentRouting.ts`, `fileProcessor.ts`, native-file support and `ReadFileTool` | Preserve native/extracted/OCR routing, file allow-lists and input materialization across model/key fallback | F-01: inspect actual image/PDF/text/audio/video inputs and errors, not only displayed attachment chips |
| `AiService.generateImage`, ai-core image wrapper, custom image models/transports/jobs, painting/tool callers | Migrate existing file/mask inputs, canonical parameters, download/result contracts and usage on both SDK and Job paths | I-01–07: correct requests, image bytes, consumer ownership, cancellation and readable saved results |
| `AiService.embedMany/rerank`, ai-core and knowledge/local-model consumers | Preserve model-specific vector dimensions, item order, rerank indices/scores, retry and invocation usage | SDK-10: independently known vector/ranking fixtures reach the real consumer without unsafe cross-model substitution |
| ai-core generation wrappers and structured-output consumers | Read the final tool-loop result with the selected v7 schema/array constraints | SDK-11: valid final data, invalid output and abort are distinguished after real tool steps |
| `packages/aiCore/src/core/context/compaction.ts`, `params/features/inLoopCompaction.ts` | Preserve existing summaries, tool/result pairing, attachment access and runtime-owned compaction distinctions | SDK-12: long multi-turn/tool/media context remains usable after compaction and history reload |
| `src/renderer/services/aiTransport`, stream persistence, Gateway SSE | Adapt v7 UI stream surface without changing transport ownership | Partial reasoning/tool input, disconnect/reconnect, approval, cancellation, and restored transcripts render consistently |
| Electron build and workspace exports | Resolve ESM externalization and actual embedded Node support | Development and packaged app load SDK/providers; exported package consumer smoke passes |

The [image workstream](./migration-plan.md#i--image-generation-and-editing) expands the image
cases and separately tracks capability integration and restart recovery. Preserve existing Job
submit/poll/cancel behavior, including its current `abandon` recovery policy, during this phase.
`generateImage` remains a wait-for-result API; adopting image Batch or durable recovery needs the M1/I4
contracts rather than being smuggled into the dependency change. Likewise, F1/R1 preserve existing file
and stream behavior before F2/R2 add new upstream capabilities.

The [release/main findings](./aisdk-v7-research.md#released-versus-main-only-changes) supplies specific
regressions for this refresh: stale approvals after `addToolOutput`, equal inputs across JavaScript
realms, merged-stream cancellation including later readers, and resumed versus new-message approval
state. The last fix is main-only; reproduce on the chosen release and record whether a later version or
scoped patch is required. Audit `convertDataPart` when using Agent UI helpers. Speech/transcription hooks
and usage are M2 adoption work unless an existing consumer is found; SkillsV4 is a separate S decision.

## 1.4 Verification and exit gate

Run real SDK/provider packages against a controlled HTTP protocol server where supported. The server
scripts model responses/errors; it must not replace the SDK with preconstructed internal events. Combine
that with real-provider smoke and packaged Electron runs. At minimum record:

| ID | Scenario | Required observable result |
|---|---|---|
| SDK-01 | Text/reasoning, structured output, two tool steps | Correct final answer/artifacts, ordered durable messages, one terminal outcome |
| SDK-02 | Missing context, schema defaults/transforms, approval allow/deny, stale output approvals and cross-realm equal inputs | Correct validated input and context; valid equal input remains approved; denied, changed or misattributed calls create no effect |
| SDK-03 | Stop, provider error, partial disconnect, model/key fallback, merged readers before/after cancel | Existing terminal/retry behavior preserved; no duplicated effect or abandoned merged reader; renderer detachment keeps its existing meaning |
| SDK-04 | Reload v6-created media/tool/data parts; approval resume versus a new message | History and model-input conversion preserve intended parts; tool pairing stays coherent; resumed approval is retained only for its own message |
| SDK-05 | Multi-step usage/cache/reasoning, tracing on/off | Per-invocation and aggregate accounting agree; opt-out respected |
| SDK-06 | I-01–07: image generation/edit/masks, SDK and custom Job delivery, painting and image-tool callers | Correct wire inputs and saved bytes; capability policy, usage, cancellation, result ownership and old history preserved |
| SDK-07 | Large streaming response and mutable nested parts | No snapshot aliasing; latency/memory measured against the pinned baseline with agreed budgets |
| SDK-08 | Production package startup and workspace exports | ESM/native loading works on supported packaged targets; no accidental environment dependency |
| SDK-09 | F-01: native/extracted/OCR inputs, external parts, large text and provider/model/key changes | Actual request contains supported content; existing per-file error policy and scoped overflow access preserved |
| SDK-10 | Embed/rerank through knowledge and local/custom provider consumers | Vector dimensions and source ordering preserved; rerank indices/scores map correctly; batch size, cancellation, retry and usage meet the caller contract |
| SDK-11 | Structured output after tool steps, array bounds, invalid/aborted output | Final result satisfies the independently defined schema; incomplete or invalid data is not reported as success |
| SDK-12 | Context overflow, compaction, long tool/media history and reload | Tool-call/result pairs, retained summaries and attachment access survive; no new generic compaction assumption |

Use existing suites as entry points: `loop/__tests__/agentLoop.test.ts`, `toolLoopTermination.test.ts`,
`params/__tests__/buildAgentParams.test.ts`, message-rule tests, usage/observability tests, and ai-core
runtime/context/provider tests. Add contract cases where missing; mocked unit coverage supplements the
black-box gate. No new test runner or dedicated command is presumed to exist.

Implementation checks: `pnpm lint`, affected `pnpm test:main <file>`, `pnpm test:aicore <file>` and
`pnpm test:renderer <file>` suites; the full `pnpm test` is appropriate for this cross-cutting upgrade.
Run `pnpm docs:check` for accompanying docs. Record real-provider and packaged results separately from
unit/CI success; use the repository Electron test workflows for app validation.

**Exit:** compatible dependency closure, all patch decisions evidenced, codemod diffs reviewed, manual
contract work complete, and SDK-01–12 passed for the declared support matrix. Downstream files, images,
recovery, tools, media and Harness workstreams cannot pass this gate with unresolved SDK regressions.

Deliver in reviewable commits: dependency/patch and codemod changes, manual contract repairs, then
black-box/packaging evidence. The resulting PR must be complete and green; intermediate commits are not
independent release candidates. Roll back by reverting the complete coherent upgrade change set. This
phase must not rewrite shipped database migrations or require deleting user data.
