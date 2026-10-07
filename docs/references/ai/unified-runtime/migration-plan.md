---
description: Post-upgrade migration plan for Agent controls, images, recovery, media, tools, and Harness cutover
sources:
  - src/main/ai
  - packages/aiCore/src/core/agents/createAgent.ts
  - packages/aiCore/src/core/context/compaction.ts
  - src/shared/ai/piBuiltinTools.ts
  - scripts/piVccBundle.ts
  - patches
  - package.json
  - pnpm-workspace.yaml
  - src/main/ai/AiService.ts
  - src/main/ai/provider/custom/imageGenerationModel.ts
  - src/main/ai/provider/custom/tasks/imageGenerationJobHandler.ts
  - src/main/ai/tools/painting.ts
  - src/main/ai/tools/generateImageTool.ts
  - src/main/ai/messages/messageCapabilities.ts
  - src/main/ai/observability/adapters/aiSdk/aiSdkSpanAdapter.ts
  - src/main/ai/runtime/aiSdk/retry/createRetryableWrap.ts
  - src/main/ai/streamManager
  - src/renderer/pages/paintings/model
  - src/renderer/services/aiTransport
  - packages/provider-registry/src/schemas/imageParamCatalog.ts
  - packages/provider-registry/src/reasoningProfiles.ts
  - src/main/data/services/ProviderRegistryService.ts
  - src/shared/ai/reasoning.ts
  - src/main/features/apiGateway/adapters/converters/providerOptionsMapper.ts
---

# AI SDK Upgrade & Unified Runtime — Migration Assessment

> Refreshed 2026-10-04. Published target comparison: `ai@7.0.127`; Cherry baseline: `e3052500309`, `ai@6.0.185`.
> This is a proposed work breakdown. No dependency, runtime, schema, or permission behavior is changed by this document.
> Main-only findings are pinned to `15f1a4d0531ac641a4a4d9cc602c0536c1906834`; see the
> [release/main findings](./aisdk-v7-research.md#released-versus-main-only-changes) before choosing packages.

## Ownership and scope

The chat runtime uses `ToolLoopAgent`; Agent sessions have a host/driver boundary with Claude Code,
Pi and DSH. Cherry owns session admission, durable messages, approval decisions, UI, credentials and
application lifecycle. Context preparation and execution authorization remain separate responsibilities.
The SDK upgrade does not merge message stores or introduce a new permission engine. Reuse existing
compaction and file owners. See the [current runtime reference](../agent-session-runtime.md).

## Implementation sequence

Existing attachments, image generation/editing, custom jobs, embedding/rerank, structured output,
compaction and UI delivery are required SDK baseline coverage. New capabilities follow that baseline
independently; file uploads and image migration do not wait for Tool Search, Code Mode or Harness.
The [research conclusions](./aisdk-v7-research.md) explain the SDK benefits and limits once; this page
owns post-upgrade adoption, implementation and acceptance. SDK compatibility, file lifecycle and tool
discovery/execution have focused plans linked below.

| Workstream | Plan and entry condition | Status |
|---|---|---|
| 1. SDK/V4 upgrade | [Dependencies, patches, codemods and SDK-01–12](./sdk-upgrade-plan.md); preserve all existing callers | Implemented in draft [PR #21310](https://github.com/CherryHQ/cherry-studio/pull/21310); real-account and packaged-matrix validation remains open |
| Agent controls and reasoning | Existing caller after the SDK baseline; [reasoning adoption](#unified-reasoning-adoption) below | Local implementation and serializer coverage; provider-account acceptance pending |
| Files and provider skills | [F/S plan](./large-file-upload-port.md); provider reference and lifecycle decisions after existing attachment parity | Files planned; remote skills decision pending |
| Images, tool media and recovery | [I/R work](#images-recovery-and-media); capability/result ownership and partial-output/effect policies | Planned; multipart content, retries and restart recovery require explicit adoption |
| 2. Tool Search | [TS plan](./tool-discovery-plan.md#phase-2--native-tool-search-on-the-aisdk-path); SDK baseline accepted | Planned on the aiSdk path |
| 3. Core Code Mode | [CM plan](./tool-discovery-plan.md#phase-3--core-code-mode-adoption-and-native-pi-parity); SDK baseline and search integration where consumed | Decision pending; retain Pi's existing native route |
| Batch/audio/video/Realtime/evaluation | [M/Q work](#m--batch-audio-video-and-realtime); named consumer and relevant file/result/approval contracts | New features decision pending; existing structured output remains mandatory |
| 4. Harness | Per-driver integration and acceptance below; only the capabilities each runtime consumes are prerequisites | Planned; required adapter gaps block the affected driver |
| 5. Cleanup | [Per-surface cutover gate](#cleanup-and-rollout-gate) after replacement evidence | Planned; historical readers and independent owners remain |

## Agent composition and execution controls

Choose a concrete caller before adding an abstraction. Parameterized agents must validate options and
isolate per-call state; scoped tools must receive only their intended dependencies, with no credentials
in dynamic descriptions. Per-step generation policy must have the intended lifetime and override order.
First-output/tool timeouts must terminate with the correct reason, and model/tool/step observations must
attribute usage once. Test ignored cancellation as an uncertain effect, not a rollback.

Adopt tool ordering, input refinement or default instructions only for an existing prompt/input problem.
Inspect actual provider schemas and refined execution/approval inputs; explicit instructions must win.
Stream composition must keep child progress distinct from final model output and close cancelled readers.
Retain `ToolLoopAgent` unless a concrete caller needs another loop. Workflow, sandbox/policy, MCP Apps
and TUI integration remain separate decisions; none introduces a scheduler or new session owner here.

## Unified reasoning adoption

The aiSdk implementation resolves each model call after SDK step-option merging, using the request's
registry contract and the current output limit. Equivalent paths use SDK `reasoning`; exact budgets,
extended efforts and custom protocols retain native delivery. The implementation contract lives in
[registry reasoning control](../../../../packages/provider-registry/docs/reasoning-control.md#ai-sdk-v7-delivery).
This remains SDK adaptation; Harness and model calls inside Code Mode are separate workstreams.

Local coverage includes real installed provider serializers, a four-step Cherry Agent run, model retry,
assistant-less calls, explicit native overrides, summaries, budget headroom and sampling. Tests use fake
transport responses; representative provider-account verification is still outstanding. Gateway and
Claude Agent SDK retain their shared native encoder, and reasoning output/replay middleware remains.

Retained native cases are intentional: Cherry's budget ratios differ from the SDK's, Claude `max` is
not `xhigh`, and the pinned xAI SDK maps Grok 4.7 portable `xhigh` to `high`. The last case needs an
upstream mapping fix before portable delivery can replace its working native field. Google deployment
aliases and adapters without demonstrated equivalent translation also keep their registry encoding.
No catalog schema or persisted selection vocabulary changes are required.

### Acceptance

Use the existing RG gates below as the completion criteria. Tests intercept the real SDK
adapter's HTTP body and inspect stream-start warnings, alongside portable-input assertions. Include `high → low → baseline`
across three steps, explicit native override conflicts, summary-only overrides, model/endpoint switches,
budget bounds and mandatory thinking. Check SDK warnings as well as the emitted fields so a coerced or
ignored choice cannot count as success. Local captures do not replace representative account tests;
record untested provider routes explicitly.

| Gate | Required evidence before cutover |
|---|---|
| RG-01: selection and caller coverage | Trace model controls → conversation/request choice → endpoint profile → final request. Decide mappings for `default`, `auto`, `max`, `ultra`, unsupported levels and mandatory thinking. Cover chat, assistant-less calls, gateway overrides and model switches |
| RG-02: one effective input policy | Pass the chosen option through `AgentOptions` and `Agent.ts`; inspect final bodies for native OpenAI/Anthropic/Google, compatible endpoints and any legacy provider. A retained native effort/budget must not silently defeat the unified or per-step choice; test `prepareCall` / `prepareStep` where used |
| RG-03: budgets and sampling | Compare existing and SDK budget calculations, minimums, output caps, temperature/topP filtering and user overrides. Preserve exact budgets or explicitly approve the changed behavior; the same label must not silently change cost/headroom |
| RG-04: defaults, off and warnings | Verify omitted/default requests, explicit off, level coercion, unsupported warnings and models that cannot disable thinking. Preserve unrelated summary/visibility options; distinguish model intent from actual wire behavior |
| RG-05: output and replay | Preserve text/reasoning-file output, summaries, signatures/encrypted content, tool-turn continuation, cross-model history filtering and token accounting. Retain output-only middleware such as OpenRouter redaction cleanup |
| RG-06: replacement and deletion | Name each replaced input serializer branch and its supported adapter/model/endpoint set; retain exact-budget/custom-dialect exceptions. Validate real SDK HTTP bodies and representative real-provider calls before deletion; document untested routes |

## Images, recovery and media

The following work preserves existing image and stream behavior during the SDK upgrade, then gates
new capability adoption separately. Files and provider skills retain their [focused lifecycle plan](./large-file-upload-port.md).
Image capability/storage design and new media entry points remain explicit decisions.

## I — Image generation and editing

### Existing paths and ownership

| Surface | Current owner / path | Required migration work |
|---|---|---|
| Painting page | `paintingPipeline.ts` → `canonicalGenerate.ts` → `ai.image.generate` | Preserve configured model, canonical parameters, input images, supported operations, cancellation, and saved paintings |
| Chat / Agent image tool | `tools/generateImageTool.ts`, `tools/painting.ts`, aiSdk `PaintingTool.ts`, Claude MCP bridge | Preserve tool schema, approval/context, input FileEntry resolution, output IDs and history; test both callers |
| SDK generation | `AiService.generateImage` → ai-core wrapper → native/custom image model | Adapt the selected model contract, file/mask inputs, result metadata, usage, and custom downloader |
| Custom submit/poll | `generateImageViaJob` → `imageGenerationJobHandler` → `ImageGenerationTransport` | Preserve canonical-to-wire conversion, task errors/progress, abort bridging, downloads and local FileEntries |
| Capability and parameter data | Provider registry, `imageParamCatalog`, `imageOptions`, `wireProfile` | Map the selected SDK's file/mask declarations to actual provider/model/endpoint support; retain vendor-specific parameters |
| Durable result ownership | FileManager, painting/message consumers, job file refs | Distinguish provider completion, download, local save, and attachment to its final owner |

The Job path currently declares `recovery: 'abandon'` and returns results to an in-process
`handle.finished` waiter. It has no durable result destination in its payload. Upgrading the SDK or
adopting Batch cannot make that path restart-safe. The image tool also currently uses `manual` cleanup
because its text result does not register ordinary message file refs. Preserve that protection until
replacement references are proven; do not switch cleanup policy as incidental migration work.

### Implementation slices

1. **I1 — Preserve both delivery paths during phase 1.** Inventory every native SDK image provider,
   custom `ImageModelV3`, and `imageTransportRegistry` registration. Record operation, endpoint,
   request encoding, file/mask support, output form, downloader, usage owner, and corresponding callers.
   Compare actual submitted requests and saved bytes on v6/v7. Keep custom routes where upstream lacks
   their protocol; a generic SDK image API is not a replacement for vendor submit/poll behavior.
2. **I2 — Integrate capabilities after the baseline.** Resolve one effective capability interpretation
   for UI controls, model-visible tool schema, and authoritative Main validation. SDK file-input and
   mask-input support are separate and can be unknown; they do not describe Cherry's whole parameter
   catalog. Record precedence/conflicts between registry declarations, model overrides, and the selected
   adapter before changing behavior. Test native SDK and custom transport routes independently.
   Unknown is not confirmed support and must not silently become supported or disable an already
   verified custom route. Choose and document the unknown/conflict policy before cutover.
3. **I3 — Preserve operation and input semantics.** Inventory text-to-image, reference-image generation,
   editing, masks, and any currently exposed remix/upscale/background operations per provider/model.
   Do not infer a distinct edit operation merely from the presence of input images. Verify count,
   MIME, size, mask requirements, parameter defaults, and provider-only options at the terminal wire
   boundary. Schema redesign remains a separate decision; SDK declarations alone do not prescribe it.
4. **I4 — Close result and task lifecycle.** Assign each result a destination (painting or tool/message
   owner); specify how downloads and reference writes settle on partial failure, cancellation and
   consumer disappearance. If restart recovery is adopted, first persist destination, input refs,
   remote task identity and attribution, then prove resume without blind resubmission. A crash after
   remote acceptance but before local task-ID persistence requires reconciliation or an explicit
   uncertain outcome. Do not just flip `abandon` to retry.
   The SDK's `GenerateImageResult.calls` now preserves each underlying call's images, response,
   metadata, warnings and usage. Evaluate it for split-call attribution while retaining Cherry's existing
   `onProviderCall` billing owner; consuming both must not double-count usage.
5. **I5 — Remove only proven duplication.** Classify each image patch, model wrapper, transport,
   downloader and renderer orchestration path as retain/replace/remove. Remove a path only after all
   its callers, operations, result ownership and provider exceptions pass. Keep historical painting and
   tool-result readers. Batch adoption is tracked under M1 and is not an I1 prerequisite.
6. **I6 — Decide multipart tool-result routing per endpoint.** `@ai-sdk/openai-compatible@3.0.62`
   introduces `supportsMultiPartToolContent`, default false. Cherry's `messageCapabilities.ts` currently
   returns `NO_MEDIA` for openai/ollama dialects and moves tool images to synthetic user messages.
   Preserve that route in phase 1, then record retain/adopt for each actual endpoint. Adoption must align
   the provider flag with Cherry message conversion; upgrading the package alone does not change it.
   Verify image/audio/video parts individually, fallback and old-history replay. Do not globally enable
   array tool content or infer support from an endpoint's OpenAI-compatible name.

Sources: [current image parameter architecture](../image-generation-parameters.md),
[SDK file/mask support](https://ai-sdk.dev/docs/ai-sdk-core/image-generation#checking-image-editing-support),
[multipart setting](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/packages/openai-compatible/src/openai-compatible-provider.ts#L94),
[wire conversion](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/packages/openai-compatible/src/chat/convert-to-openai-compatible-chat-messages.ts#L303),
and the source owners listed above. Recheck live SDK documentation against the chosen package lock.

### Image acceptance

Use the real SDK/adapters with protocol fixtures, then representative real providers and packaged UI.
Run each applicable case through the painting page and image tool, including the Claude bridge.

| ID | Scenario / failure | Observable acceptance |
|---|---|---|
| I-01 | Native, compatible and custom providers; generate one/multiple images | Correct endpoint and canonical-to-wire values; actual image bytes saved and visible to the correct consumer |
| I-02 | Reference images, edit and mask; invalid MIME/count or unsupported operation | Supported inputs reach the provider unchanged; invalid requests are rejected before a billable call; no silent text-only generation |
| I-03 | Capability true/false/unknown and registry/adapter conflict | UI, tool schema and Main follow the recorded policy; model switching does not retain invalid settings |
| I-04 | URL/base64 output; protected download, bad URL, partial download/save failure | Proxy/auth policy and abort reach the download path; no false full success, cross-origin credential leak or lost successful artifact |
| I-05 | Async submit/poll failure; stop during submit, poll or download | No automatic duplicate paid submission; local terminal state settles; remote cancellation outcome is represented accurately |
| I-06 | Provider succeeds but local save/consumer attachment fails | Invocation usage is retained once; result ownership and retry/reconciliation policy distinguish remote success from delivery failure |
| I-07 | Reopen painting/chat history, reuse a generated image for editing, GC of temporary inputs | Images remain available to their owners; active jobs retain inputs; discarded scratch files are eventually reclaimable |
| I-08 | If recovery is adopted: crash before/after task-ID save, download and destination write | Recovery reaches the original destination once; uncertainty never triggers blind resubmission; current abandon behavior is not reported as recovery |
| I-09 | Multipart setting on/off, supported/unsupported tool media, endpoint/model fallback and history replay | Actual tool-message payload follows the route decision; media remains accessible and attributed once; unsupported endpoints retain the verified conversion path |

I-01–07 supply the detailed scenarios behind SDK-06. I-03 preserves verified existing behavior during
phase 1 and gates the new shared capability policy in I2. I-08 gates I4's recovery adoption separately;
I-09 gates I6's optional endpoint adoption, with existing conversion preserved by SDK-04.

## R — Stream recovery and UI delivery

### Separate the mechanisms

Cherry's `runtime/aiSdk/retry/createRetryableWrap.ts` covers key failover, same-model retry and model
fallback before content is emitted. `streamManager/pipeStreamLoop.ts`, its persistence listeners, and
renderer `TopicStreamSubscription` / `ExecutionStreamOverlayService` own projection and reconnect.
Neither should be deleted on the assumption that SDK `streamRetries` or resumable UI parts replace it.

1. **R1 — Baseline UI migration, in phase 1.** Adapt stateless stream helpers and test snapshot isolation,
   partial text/reasoning/tool input, metadata, abort, and approval continuation. Include the Gateway
   SSE adapters and all existing listeners. A stored UI snapshot does not by itself restore a live
   stream parser or a provider connection. Record whether the `7.0.125` Agent helper `convertDataPart`
   applies to any current custom data parts; verify model-input conversion and history without dropping
   or accidentally promoting UI-only data into model instructions.
2. **R2 — Provider stream recovery, after phase 1.** Define which provider error events qualify, total
   attempts across nested retry layers, request deadlines, cancellation, and usage attribution. Keep
   `streamRetries` off until failed-attempt output and effect handling pass. Account for the research's
   constraint that already-emitted text/reasoning/files cannot be retracted and provider-side effects
   cannot be rolled back. Record whether UI marks attempts, replaces provisional output, or explicitly
   surfaces an interrupted response; do not silently concatenate two answers as one successful turn.
3. **R3 — Delivery and observability.** Test actual reconnect/replay for all supported listeners and
   persisted terminal messages. Evaluate optional SSE heartbeats only on SSE paths; do not introduce
   fake message/usage events or change IPC semantics. Preserve retry attempt spans, opt-out policy,
   request identity and one final durable outcome.
   Compare SDK `UIMessageStreamOutcome` and `isCancelled` with Cherry's terminal state explicitly.
   Consumer cancellation before an outcome is declared can remain `unknown`; it is not completion.
   Preserve Main generation across renderer detachment and distinguish operation failure from a tool error.
4. **R4 — Cleanup.** Remove snapshot/retry patches per hunk only when their protected behavior is
   covered. Keep cross-model routing, key failover, host persistence and transport subscriptions where
   they still own distinct behavior.

| ID | Scenario / failure | Observable acceptance |
|---|---|---|
| R-01 | Disconnect during partial text/reasoning/tool JSON, then reconnect | Live and reopened transcripts agree; no missing active parts, duplicate terminal events or corrupted tool inputs |
| R-02 | Retryable provider event after visible output, then success/exhaustion | Failed and successful attempts follow the chosen projection policy; retained usage records actual invocations without duplicate message accounting |
| R-03 | Failed attempt contains client tool/approval or provider-executed effect | Withheld client actions do not execute; committed effects are not blindly repeated; stale approvals cannot authorize the next attempt |
| R-04 | Abort/deadline during retry delay; key/model fallback plus stream retry | Work stops within the declared bound; attempts stay within one documented budget; files/options rebind to the actual provider |
| R-05 | Long stream, nested mutable metadata, slow/disconnected consumer | Snapshot isolation and agreed latency/memory bounds hold; closing a renderer does not lose Main-owned output |
| R-06 | SSE heartbeat enabled/disabled, approval continuation, tracing on/off | Consumers accept framing; heartbeats create no content or usage; decisions and spans retain the correct owner |
| R-07 | Cancel outer merged stream before/after inner reader registration | Existing and later-merged readers cancel; no abandoned reader continues emitting or keeps resources alive |

For R-06, include stale approval removal after `addToolOutput`, equal approved inputs from another
JavaScript realm, and approval resume followed by a new message. The first two fixes are released in
`7.0.126–127`; approval-state preservation on resume is main-only at this snapshot. Keep prior approved
state only for the same resumed message; a new message must not inherit it. Reproduce against the chosen
release and record a version blocker or scoped fix if needed. R-07 covers the published `7.0.127` merged
stream fix; it does not change Cherry's rule that renderer detachment alone leaves Main generation alive.

R-01, R-05, R-07 and existing approval/transport behavior in R-06 are phase-1 obligations. R-02–04 and new
heartbeat activation require separate adoption evidence. The [recovery research](./aisdk-v7-research.md#tools-approvals-and-recovery)
supplies the researched retry semantics; verify them against the installed package, not mocked SDK events.

## M — Batch, audio, video, and Realtime

These are tracked work packages, not an unowned "later" list. Their current disposition is
**decision pending**: the research establishes opportunities, but does not define product entry points
or authorize enabling every experimental API. Before implementation, record adopt/defer/retain with
reason, provider/model coverage, destination and acceptance. A deferral needs a revisit trigger and a
named tracking record; no such decision has been made by this document.

| ID / research capability | Integration boundary and prerequisite | Implementation / decision record | Black-box adoption gate |
|---|---|---|---|
| M1 — Batch: text, tools, per-request models and images | JobManager, provider config, FileManager and durable result consumers; SDK baseline, F for any uploaded inputs, I4 for image destinations | Define submit/status/results/list/cancel, stable item IDs, mixed success, attribution, polling vs webhook delivery, input retention and replay; image generation's wait-for-result API stays distinct | M-01: out-of-order/partial results attach to the correct item once; duplicate notifications, restart and cancel do not resubmit paid work or lose completed outputs |
| M2 — Speech generation, transcription and streaming transcription | Inventory actual consumers first; media capture/playback, IPC, provider adapter and file/message result ownership | Define formats, partial/final transcript, backpressure, timeout, cleanup, operation/callId attribution, usage units and telemetry opt-out | M-02: actual audio/transcript is delivered without duplication; success/error/cancel settles once; stop releases resources; provider usage retains its units; unsupported models give an explicit outcome |
| M3 — Streaming speech translation | M2 media lifecycle plus target-language/config ownership; ordinary text translation retains its own contract | Map source/translated text and audio, ordering, interruption, usage and durable outputs | M-03: interrupted/reconnected translation preserves attribution and completed segments, with no cross-session audio or double playback |
| M4 — Async video | Provider-specific generation/status interface, JobManager and durable file/result destination; F if references are uploaded | Define image/video reference inputs, remote task identity, poll/webhook completion, expiry, download, cancel and uncertain submission | M-04: reconnect/restart collects the original task where supported; expired URLs, download failures and late completion do not become a false success or duplicate charge |
| M5 — Realtime Live | Electron media permissions, Main-held credentials, WebSocket relay or scoped browser-direct session, host tools and approvals | Select a supported transport/provider; define session/context ownership, tool execution, bounded queues, turn interruption, usage, close and reconnect | M-05: voice turn and approved tool effect complete through the real connection; denial causes no effect; network loss, barge-in and window close release resources and preserve intended turn attribution |

Do not infer an existing product implementation from an SDK export or from attachment support for audio
and video. Inventory shared `ai` imports and wrappers during phase 1; if an existing caller is found,
its compatibility becomes mandatory phase-1 work even while a new M feature remains undecided. Reuse
existing Job/File/IPC owners where their contracts fit; do not add a universal media service speculatively.

**M2 telemetry acceptance:** `ai@7.0.124` adds speech/transcription telemetry and provider usage.
Ordinary operations use `onStart/onEnd`; streaming transcription has experimental start/end callbacks,
and its error/cancellation path uses `onError`. Text-generation `onAbort` is not a universal audio hook.
Map these to the actual operation and call ID with one terminal outcome, preserving tokens, characters
and seconds as distinct units. Cover tracing off, content-recording policy, provider failure and user
Stop. Cherry's current span classification has no speech/transcription operation mapping, and this
scan found no direct production SDK speech/transcribe caller: these are conditional M2 adoption gates,
not a claim that an existing audio product has regressed.

Sources: [telemetry contracts](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/src/telemetry/telemetry.ts),
[stream transcription lifecycle](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/src/transcribe/stream-transcribe.ts),
and [provider usage units](https://github.com/vercel/ai/blob/ai%407.0.127/packages/otel/src/provider-usage-attributes.ts).

## Q — Structured output and evaluation

**Q1 — Existing structured-output migration is mandatory.** Audit ai-core generation wrappers and
callers reading final results. SDK-11 must use a real multi-step tool loop whose final step returns
structured data, assert the independently specified schema (including supported array constraints),
and cover invalid output, abort and unavailable final output. Compile success or an object assembled by
a mock is insufficient.

**Q2 — `experimental_evaluate` adoption is decision pending.** Identify a concrete evaluation consumer
and dataset before adding a runner. If adopted, map Choice/Score/Boolean questions, shared state, judge
configuration, results, cost and opt-in telemetry to an explicit evaluation record. Q-01 acceptance:
known fixtures produce schema-valid scored records; invalid judge output, cancellation and retry settle
without duplicated records; tracing off stays off. Model judges supplement deterministic outcome checks
and real-provider tests; they cannot certify file persistence, authorization or exactly-once effects.

## Phase 4 implementation slices

| Slice | Concrete work at the existing runtime boundary | Removal / acceptance |
|---|---|---|
| H1 — Shared integration | Map lifecycle, chunks, approvals, usage and resume state to `AgentRuntimeConnection`; keep admission, persistence, delivery and reconciliation in Cherry | Prove a real vertical slice; one terminal telemetry event on success/error/abort; if ACP is selected, bind approval to tool/input and reject stale/reused relay authorization |
| H2 — Pi | Map current Pi 1.0 provider/auth, native Code Mode/search/MCP, local skills, nested approvals, VCC, steer, fork/edit and context reporting; compare native dependency closure explicitly | Replace direct SDK plumbing only after the H2 detail below and full runtime matrix pass; retain native integration until then |
| H3 — Claude Code | Integrate a local filesystem/process sandbox bridge; preserve native identity, fork/edit, background events, managed binaries, credentials and cost attribution | Packaged/background acceptance plus multiple-result and resumed-session cost cases; do not sum cumulative totals or book prior session cost as a new invocation |
| H4 — DSH | Establish upstream/custom adapter support; confirm ACP compatibility before choosing ACP; preserve goal/autonomous rounds, checkpoints, approvals and tool policy | Capability blocker until an adapter exists and passes the same product contract; naming a custom wrapper is not completion |

Pi is the proposed first slice because it avoids the Claude sandbox-bridge integration, but current
fork/policy/event gaps still block cutover. Resolve upstream gaps before downstream workarounds. No
runtime may silently lose a shipped capability to make the shared interface smaller.

### H2 — Current native Pi contract

Cherry pins `@earendil-works/pi-ai` and `pi-coding-agent` to `1.0.0`, and pi-vcc to `0.8.1`.
`PiRuntimeConnection` installs native Code Mode (`models: false`), tool search, MCP and VCC extensions;
`piMcpExtension.ts` supplies Cherry's in-memory transport while Pi owns discovery, execution, results and
teardown. `approvalExtension.ts` gates nested `tool_call` events. The old `piCodeMode.ts` worker is gone.

At the pinned upstream main, [Harness Pi dependencies](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/packages/harness-pi/package.json)
still use `pi-ai@0.74.2`, `pi-coding-agent@^0.85.1` and `pi-mcp-adapter@2.12.1`. Existing provider,
extension-factory and in-process reattach hooks are useful integration surfaces, not proof of Pi 1.0
parity. Resolve native API/type/patch and packaging differences upstream before a downstream workaround;
version differences alone are not evidence of a runtime failure.

| Current shipped contract | H2 acceptance before replacement |
|---|---|
| Native Code Mode/search/MCP and nested approval | Real approved/denied nested effects, disabled tools, stable MCP identities/results and transport teardown; no model-call escape through Code Mode |
| Default VCC compression and `vcc_recall` | Long session compresses; recall retrieves the same session's prior content after JSONL close/reopen; another session's history is inaccessible |
| Explicit `/compact` instructions | Instructions still delegate to native summarization instead of being ignored by VCC |
| Independently disabled recall and legacy `tool_exec` policy names | Disabling recall does not turn off compression; stored disabled-tool policy maps to native names without widening access |
| Cherry-owned VCC configuration and command surface | Configuration uses Cherry's path without consuming CLI configuration; CLI-only VCC command remains unexposed |
| Native SDK and VCC ESM loading | Packaged Electron loads the SDK and dedicated VCC bundle without a development checkout |

Current contract evidence: `src/main/ai/runtime/pi/` contains `PiRuntimeConnection.ts`,
`piMcpExtension.ts`, `piSdk.ts`, `piNativeTools.test.ts` and `piVcc.test.ts`; also inspect
`src/shared/ai/piBuiltinTools.ts`, `scripts/piVccBundle.ts` and the pi-vcc patch. These tests identify contracts; no Harness
parity run has been performed. Fork/edit, live-policy and off-turn gaps below still block cutover.

## Workstream evidence

For each phase record implementation PR/SHA, exact dependency lock, changed/retained/deleted surfaces,
commands and observed outcomes, unresolved gaps, real-provider/platform coverage and rollback evidence.
Advance from `planned` to `implementing`, `blocked on capability`, `validated`, and `rolled out` using
actual evidence. Documentation completion, CI success, and production cutover are separate states.

## Cleanup and rollout gate

Maintain a per-surface ledger: old caller/module/patch → replacement or retention reason → affected
provider/runtime/operation → acceptance evidence → rollback/history requirements → removal PR.

- Tool/runtime completion does not authorize removing file materialization, image transports, Job
  handlers, retry wrappers, media adapters or their patches. Each needs its own replacement evidence.
- Inventory both live and persisted consumers: ordinary/temporary chat, Agent/Assistant tools,
  painting UI, Gateway, channels and exported workspace packages where applicable. An untested caller
  is an open gate, not evidence that a module is unused.
- Preserve stored message/tool/painting readers and outstanding file/job references. Use appended
  migrations if a selected feature needs new durable state; do not rewrite shipped migrations.
- Roll out per provider/runtime route with one execution path per request. Verify rollback can still
  read data and settle work created by the new path; uncertain paid submissions must not be replayed.
- Close all required parity and adopted-capability gates, account for intentional retained code, and
  record every deferral explicitly. A local slice can ship while an independent slice remains open;
  the whole migration cannot be declared complete on the basis of Harness alone.

## Harness migration direction

The target is to move all **Agent execution backends** behind Harness. Full replacement is the desired
end state; compatibility has not yet been demonstrated. This updates the earlier optional-experiment
position. It does not imply moving ordinary chat into Harness.

Cherry continues to own session admission, durable messages, approval decisions, cross-session delivery,
UI projection, credentials, and application lifecycle. Harness should own the reusable runtime adapter
and native execution mechanics. Implement the integration at the existing
`AgentSessionRuntimeDriver` / `AgentRuntimeConnection` boundary; avoid a second competing session host.
Replace direct SDK plumbing where upstream covers it, without merely relocating the whole old driver
into a nominal Harness adapter.

Sources: [upstream adapter catalog](https://github.com/vercel/ai/blob/ai%407.0.123/content/docs/03-ai-sdk-harnesses/05-harness-adapters.mdx),
[HarnessAgent API](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent), and Cherry's
[current runtime contract](../../../../src/main/ai/runtime/types.ts).
The checked upstream capability table marks built-in history access unsupported. Resuming native agent
state, reading native history, and restoring Cherry's transcript are separate requirements.
Caller-owned sandbox resources still require caller cleanup.

If an adapter drops required native events or lifecycle operations, record the missing contract and
propose an upstream improvement before implementing a Cherry workaround. Do not infer fork, history,
background-task, or live-policy support from basic stream/send/stop support. Shared integration must
preserve runtime-specific capabilities rather than silently reducing every runtime to the common subset.

### Known gaps in the inspected implementation

The following were rechecked at main `15f1a4d0531a`; they are static findings, not reproduced upstream bugs:

- **Fork/edit:** `HarnessV1Session` exposes resume/continue but no fork/edit/rewind operation; the checked
  Claude/Pi adapters do not wire the native branch/edit capabilities needed by Cherry.
- **Background output:** Pi's subscription drops non-compaction events when no turn consumer exists.
  Claude's bridge closes its query after a result when no active steering messages remain. Neither is
  evidence of parity with Cherry's long-lived background/autonomous output handling.
- **Live policy:** built-in permission mode/filtering are start options; there is no corresponding public
  live setter. Harness host-tool approval is a status map without core `ToolLoopAgent` policy callbacks.
  Per-turn `prepareCall` does not itself supply Cherry's live policy reconciliation contract.
- **Steering:** Claude waits for native acceptance acknowledgements; Pi calls the native steer queue.
  Neither a returned promise nor acceptance proves consumption. Cherry needs consumption boundaries
  and undelivered-input recovery to preserve message attribution.
- **Introspection and recovery:** the common session contract does not expose Cherry's context-usage or
  slash-command catalog queries. A stopped/lost runtime may continue by rerunning work; that is different
  from attaching to a still-running turn and does not guarantee non-idempotent tool effects occur once.

Evidence: [session contract](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/packages/harness/src/v1/harness-v1-session.ts),
[Pi event subscription](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/packages/harness-pi/src/pi-session.ts#L1159),
[Claude turn termination](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/packages/harness-claude-code/src/bridge/index.ts#L673),
and [Harness settings](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/packages/harness/src/agent/harness-agent-settings.ts).
These are requirements for upstream adapter/contract work before full replacement, not reasons to
silently remove existing Cherry features. Track request acceptance, actual input consumption, execution,
and durable completion separately in black-box evidence.

## Black-box acceptance

**Status: planned, not executed.** A passing upstream suite or a Cherry suite that mocks the runtime SDK
cannot certify this migration. The test subject includes Cherry's integration, the installed Harness
package, the real adapter, and its real native SDK/child process.

Use three complementary levels:

1. **Deterministic protocol-boundary tests.** Where a runtime supports a configurable endpoint, use a
   controlled HTTP model server to return scripted real protocol responses, tool calls, delays, disconnects,
   and errors. Keep Harness, the adapter, and native execution real. Run tools against temporary workspaces
   and a local MCP server; inspect file contents, effect counters, approvals, persisted messages, and process
   lifetime. Use production migrations for database-backed host tests. Never mock the SDK into emitting the
   event sequence being asserted. Unsupported endpoint injection is a coverage gap, not permission to call
   an SDK mock a black-box test.
2. **Real-provider runs.** Exercise supported authentication/model routes, actual tool execution, approval,
   multi-turn continuation, steering, and restart recovery. Assert task outcomes and safety invariants rather
   than exact model prose. These runs cover protocol assumptions that a controlled endpoint can miss.
3. **Packaged Electron runs.** Repeat the critical scenarios in installed builds on supported macOS,
   Windows, and Linux targets. Verify binary acquisition, native modules, paths with spaces/non-ASCII text,
   child-process environment, cancellation, and application shutdown. A Node-only test is insufficient.

| Scenario / injected fault | Observable acceptance condition |
|---|---|
| Multi-turn conversation, tools, MCP, skills, attachments | Correct workspace artifacts and tool results; one durable user admission; transcript survives reopening; no cross-session content |
| Native/remote file inputs, workspace copies and image-tool output across runtime cutover | Inputs remain accessible only to their intended session; returned images remain readable/reusable after reopening; adapter changes do not discard file parts or relax attachment access |
| User questions, structured output, per-turn settings and lifecycle callbacks | Questions bind to the right pending turn and settle on answer/cancel; supported final schemas and setting changes survive mapping; unsupported adapter capabilities remain explicit |
| Denied approval, disabled tool, stale/duplicate approval reply | Zero prohibited effects; approval binds to the intended session, tool, and input; duplicate responses cannot execute twice; pending UI resolves correctly |
| Policy changes during an active turn; update failure | Tool-policy changes and turn-frozen permission mode follow the existing reconcile contract; failed application prevents execution under stale policy |
| Steer during tool execution and just before completion | No abort caused by steer; consumed input appears between pre/post-steer assistant output; accepted-but-unconsumed input becomes the next turn exactly once |
| User Stop, blocked tool, hung process, app shutdown | Terminal UI state settles; no new work is admitted; cancellation and cleanup complete within a declared deadline; caller-owned resources are not accidentally destroyed |
| Bridge disconnect before/after tool effect; duplicate event delivery | No silent duplicate side effect or transcript replay; an uncertain non-idempotent outcome is surfaced instead of blindly retried; completed messages and usage are not duplicated |
| Crash during generation or approval; cold restart | Resume reaches the right native session and Cherry transcript; stale approval cannot auto-execute; unsupported in-flight continuation is explicitly surfaced without losing the request |
| Fork/edit at a saved boundary | Original session stays intact; branch starts from the selected boundary with no future-message leakage or active writer corrupting history |
| Background subagent/DSH goal round overlaps queued input | Output stays attached to its actual owner; autonomous turns cannot consume interactive steering; delivery and scheduled turns keep distinct attribution |
| Model/credential change, compaction, usage events | Selected settings reach the next eligible turn; tool-call/result pairs survive compaction; credentials stay out of persisted config/logs; usage is attributed once to the correct invocation |
| Pi VCC compression, recall after reopen, instructions and disabled recall | H2's native contracts pass through the real adapter, including configuration isolation and packaged ESM loading |
| Harness success/error/abort and Claude multiple results/resumed prior cost | One correctly classified terminal event per call; latest cumulative cost is not summed repeatedly or mistaken for current-invocation cost |
| Concurrent sessions, archive/restore/purge, repeated reconnect | Native identity and workspace remain isolated; recovery does not duplicate admitted work; cleanup respects surviving/trashed sessions and ownership |

For each case define the promised result before running it. Run the same contract scenarios against the
current direct driver and the Harness path; disagreements require investigation, because the existing
driver can also contain bugs. Do not use byte-for-byte traces or existing behavior snapshots as the oracle.
Trigger races with explicit protocol/tool barriers, then repeat schedules with recorded seeds; avoid
sleep-only assertions. Record exact package/native-binary versions, platform, scenario, expected/observed
outcomes, sanitized event timeline, database/artifact evidence, and remaining coverage gaps.

## Cutover gates

1. Pin the Harness, adapter, transitive native SDK/CLI, and sandbox versions used by the experiment.
   Audit existing Cherry patches and native features; name every unsupported required capability.
2. Build the common contract suite and run a baseline against the current drivers. Prove one complete
   Harness vertical slice before expanding to the remaining runtimes.
3. Require every applicable acceptance scenario to pass for a runtime, including real-provider and
   packaged runs. A missing required capability blocks that runtime's replacement; it is not a skipped
   green test. Establish a safe path for existing native sessions and persisted resume tokens.
4. Switch one runtime at a time. Keep a tested rollback route during rollout, without dispatching a user
   request to both implementations. Verify state compatibility before reverting a session already used
   by the new path. Remove the superseded driver after acceptance and rollout validation.
5. For upstream defects, retain a minimal reproduction and regression case, report the upstream issue,
   and pin a known-good version or explicitly scoped fix. Rerun affected black-box cases on each adapter
   or native SDK upgrade. Upstream ownership reduces maintained code; it does not transfer responsibility
   for Cherry's user-visible behavior.
