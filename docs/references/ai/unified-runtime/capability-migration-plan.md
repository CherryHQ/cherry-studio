---
description: Migration work for image generation and editing, stream recovery, Batch, audio, video, Realtime, and evaluation, with source boundaries and acceptance gates
sources:
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
---

# Capability Migration — Images, Recovery, and Media

> Refreshed 2026-10-04 against Cherry `e3052500309`, published `ai@7.0.127`, and pinned main
> `15f1a4d0531ac641a4a4d9cc602c0536c1906834`. [Released and main-only changes](./aisdk-v7-feature-inventory.md#release-and-main-delta-ledger)
> have separate adoption/version records.
> All implementation and runtime acceptance below are **planned**, not completed.

The [research coverage matrix](./migration-plan.md#research-coverage) is the scope ledger. Files have
their own [implementation plan](./large-file-upload-port.md). This document supplies the missing work
behind the other non-tool capabilities; Tool Search, Code Mode, and Harness cannot certify these paths.

Existing image, attachment, stream, embedding, and rerank behavior must pass the SDK upgrade gate.
New SDK facilities then have their own adoption gates. Adding an API to this plan does not silently
enable a product feature or settle an unresolved capability/storage design.

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
heartbeat activation require separate adoption evidence. The [feature inventory](./aisdk-v7-feature-inventory.md#execution-boundaries)
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

## Shared acceptance and removal record

Each implemented slice records exact SHA/package lock, provider + model + endpoint + credential mode,
product entry point, platform, fixtures, observed outbound requests, durable outputs, failures and
rollback results. Unit, protocol-boundary, real-provider and packaged-app results remain separate.
Unsupported or untested matrix cells stay visible; a passing representative provider is not all-provider
coverage. Reuse the [Harness plan's three validation levels](./migration-plan.md#black-box-acceptance).

Before deletion, attach the replacement and acceptance evidence for every retired caller, patch and
protocol path. Historical readers, active task inputs, output references and still-used custom providers
are retention requirements. Finishing Harness does not complete this record for files or media.
