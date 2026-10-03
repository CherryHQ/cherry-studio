---
description: AI SDK v7 research coverage and migration tracker for baseline compatibility, files, images, recovery, tools, media, Harness, and cleanup gates
sources:
  - src/main/ai
  - packages/aiCore/src/core/context/compaction.ts
  - src/shared/ai/piBuiltinTools.ts
  - scripts/piVccBundle.ts
  - patches
  - package.json
  - pnpm-workspace.yaml
---

# AI SDK Upgrade & Unified Runtime — Migration Assessment

> Refreshed 2026-10-04. Published target comparison: `ai@7.0.127`; Cherry baseline: `e3052500309`, `ai@6.0.185`.
> This is a proposed work breakdown. No dependency, runtime, schema, or permission behavior is changed by this document.
> Main-only findings are pinned to `15f1a4d0531ac641a4a4d9cc602c0536c1906834`; see the
> [release/main ledger](./aisdk-v7-feature-inventory.md#release-and-main-delta-ledger) before choosing packages.

## Current baseline

The chat runtime already uses `ToolLoopAgent`. Agent sessions have a host/driver boundary with Claude
Code, Pi, and DSH drivers; they are not a Claude-Code-only stack. Cherry also has
`compactModelMessages` and `src/main/ai/runtime/aiSdk/params/features/inLoopCompaction.ts`.
Use the [current runtime reference](../agent-session-runtime.md) for ownership and lifecycle details.

The original June plan and its measurements are preserved below. Its "locked" statuses do not apply to
the revised assessment; old paths and code counts must be rechecked before implementation.

## Reassessed decisions

| Original decision | Current assessment | Next verification |
|---|---|---|
| D1: stay on v6 | Upgrade to a pinned v7 baseline as phase 1, before feature migrations | Close dependencies/patches, codemods, manual semantic work, and SDK-01–12 |
| D2: reject Harness | Target Harness for all Agent execution backends, with replacement gated separately for each runtime | Prove the Cherry contract through real runtime black-box tests; close upstream adapter gaps before cutover |
| D3–D4: context/safety model and prepareStep limits | Retain as design principles for the proposed shared loop, not a description of every driver | Identify concrete product requirements before changing orchestration |
| D5: collapse drivers, stores, and permission logic | Not a prerequisite for the SDK upgrade | Audit current data/lifecycle owners; propose each change separately if needed |
| D6: steer always aborts/restarts | Do not impose globally; runtime-native steering is adapter-dependent | Verify acceptance, ordering, cancellation, and user-visible behavior per runtime |
| D7: borrow session lifecycle contracts | Compare with the existing host/driver contract before adding another one | Separate session resume, approval continuation, sandbox ownership, and history availability |

## Implementation sequence

**Upgrade AI SDK first, preserving every existing capability.** The old linear summary — SDK → Tool
Search → Code Mode → Harness → cleanup — only described the tool/runtime branch. It was incomplete as
the program plan. Files, images and stream recovery are peer workstreams with their own owners and
cutover gates; media/evaluation opportunities require explicit adoption decisions, not silent omission.

Before implementation, complete the source/caller/provider inventory below and establish the existing
behavior baseline. That planning step is not a dependency upgrade. SDK phase 1 remains the first code
change. Existing attachment, image/edit, embedding/rerank, structured-output and UI behavior are required
in that phase, even when new capabilities in the same domain ship later.

| Workstream | Deliverable and implementation record | Entry requirement | Exit gate / status |
|---|---|---|---|
| 1. AI SDK upgrade | [Version/patch audit, all 32 codemods, manual semantic migration, regression plan](./sdk-upgrade-plan.md) | Exact Cherry baseline and supported provider/platform/caller matrix | SDK-01–12, including detailed file/image/UI cases, compatible peers, reviewed patches and package builds; **planned** |
| F. FilesV4 | [Attachment/upload/reference lifecycle plan](./large-file-upload-port.md#f--implementation-slices) | Existing attachment gate in phase 1; provider reference support and lifecycle decisions | F-01–06: usable content, scoped references, expiry, cancellation, cleanup, replay; **planned**, store/policy decisions unresolved |
| S. Provider skills | [SkillsV4 upload and inference binding](./large-file-upload-port.md#s--provider-skill-uploads) | Explicit adopt/retain-local/defer choice, provider/account/version and operation support | S-01–03 if adopted; local/Harness skill contracts stay distinct; **decision pending** |
| I. Images and tool media | [Generation/editing, capabilities, custom transports, result ownership and multipart tool output](./capability-migration-plan.md#i--image-generation-and-editing) | I1 baseline in phase 1; capability conflicts resolved before I2; destination design before recovery; endpoint decision before I6 | I-01–07 for current paths and capability adoption; I-08 for restart recovery; I-09 for multipart adoption; **planned**, I6 decision pending |
| R. Recovery and UI | [Provider retry, partial UI parts, reconnect, SSE and patch disposition](./capability-migration-plan.md#r--stream-recovery-and-ui-delivery) | R1 baseline in phase 1; effect/output/attempt policy before enabling retries | R-01–07 as applicable; **planned**, new retries disabled until accepted |
| 2. Tool Search | [Request binding, callback ranking, direct dispatch, prompt/UI/history changes, deletion map](./tool-discovery-plan.md#phase-2--native-tool-search-on-the-aisdk-path) | Phase 1 accepted | TS-01–09, real-provider and Electron validation; **planned** |
| 3. Code Mode | [Core adoption, leftover worker cleanup and native Pi parity](./tool-discovery-plan.md#phase-3--core-code-mode-adoption-and-native-pi-parity) | Phase 1 accepted; Phase 2 accepted for native Core search integration | CM-01–10 for adopted routes; keep native Pi under H2, audit unused code separately; Core activation **decision pending** |
| M. Batch/audio/video/Realtime | [M1–M5 product, provider, lifecycle and acceptance records](./capability-migration-plan.md#m--batch-audio-video-and-realtime) | Phase 1; relevant file/result/approval contracts for each selected feature | M-01–05 if adopted; each item otherwise needs reason, tracking record and revisit trigger; **decision pending** |
| Q. Structured output/evaluation | [Existing-output migration and experimental evaluation adoption](./capability-migration-plan.md#q--structured-output-and-evaluation) | Existing structured output in phase 1; evaluation consumer/dataset before Q2 | SDK-11 mandatory; Q-01 if evaluation adopted; **Q1 planned, Q2 decision pending** |
| 4. Harness | Common integration, then Pi / Claude Code / DSH adapter cutovers below | Phase 1 accepted; applicable tool, file/image, approval and delivery contracts stabilized | Each runtime passes the complete product matrix, including attachments and image-tool outputs; **planned** |
| 5. Cleanup and rollout | Per-surface replacement/removal records, historical readers and rollback | Applicable capability replacements validated, all callers accounted for | [Cleanup gate](#cleanup-and-rollout-gate); **planned**, Harness completion alone is insufficient |

Dependency and codemod work in phase 1 is one coherent SDK upgrade, not a separately shippable feature.
Do not begin with `tool_search`, turn on Code Mode while fixing compiler errors, or use a successful
upgrade as evidence that the later workstreams already pass. F/I/R and tools can progress independently
after their shared baseline; neither file upload nor image migration waits for Harness. Harness only
depends on capabilities its runtime actually consumes, not on every new media feature. The retained
phase numbers identify existing detailed plans, not a total ordering of all work. Chat does not gain
Code Mode implicitly through this sequence.

## Research coverage

Every capability or migration boundary in [research](./aisdk-v7-research.md) and its
[feature inventory](./aisdk-v7-feature-inventory.md) has a disposition below. **Required** means existing
behavior must survive the upgrade; **planned adoption** means implementation is still pending;
**decision pending** means the product/architecture choice has not been made. None means validated.

| Research item | Cherry surface / required work | Record and acceptance |
|---|---|---|
| Dependency closure, V2/V3/V4 providers, community providers, ESM/ES2022 | Root/workspace exports, peers, overrides, patched native/compatible endpoints and packaged Electron | Required: SDK §§1.1–1.3, SDK-08; per-provider native/compatibility/blocked disposition |
| Every core/React/provider patch | Hunk-by-hunk protected behavior and upstream equivalent; image downloads and UI snapshots are separate | Required: SDK patch ledger, SDK-01–12 as applicable; deletion needs evidence |
| Context and instructions | `Agent`, ai-core executor, tool context, prompt features/repair; shared runtime vs tool contexts and trusted system history | Required: SDK-01–02, SDK-12 |
| Approval, reasons, transformed input, signed continuation | Main approval authority, stored pending decisions, nested execution and resumed inputs | Required: SDK-02/04; TS/CM and per-runtime Harness approval cases |
| Lifecycle callbacks, results, aggregate/final-step usage | Hook composition, usage/cost persistence, retry/model/tool parentage | Required: SDK-01/03/05; no duplicated terminal or billing records |
| Telemetry / separate OTel | Per-call instrumentation, opt-in policy and retry/approval spans; audio operation hooks and usage units | Required: SDK-05; R-06, M-02 and Q-01 as applicable |
| Reasoning, provider options and prompt/media parts | Message conversion/replay, endpoint-specific options, native/compatible wire contracts | Required: SDK-01/04/09/12; old provider acceptance is not new-feature parity |
| Structured output, arrays, final tool-loop result | Real final-step extraction and schema constraints through ai-core/callers | Required: Q1, SDK-11 |
| Embedding and rerank | `AiService.embedMany/rerank`, knowledge indexing/search and local/custom providers | Required: SDK-10; ordering, dimensions, scores, retry and usage preserved |
| Existing attachment inputs and FilesV4 lifecycle | Local ingestion, native vs extraction/OCR, upload/reference readiness, expiry/account scoping, cleanup, replay | Required F1/SDK-09; planned adoption F2–F5, F-02–06 |
| Provider `uploadSkill` / `SkillsV4` | Remote skill file set, provider/account/version reference and inference binding, separate from local and Harness skills | S1 decision pending; S-01–03 if adopted; no inherited FilesV4 lifecycle APIs |
| Image generation/editing and SDK image capabilities | Painting UI and tools, SDK/custom transports, parameters, file/mask inputs, downloads, usage and durable results | Required I1/SDK-06; planned capability adoption I2–I3; I4 recovery needs destination decision; I-01–08 |
| OpenAI-compatible multipart tool outputs | Provider flag plus `messageCapabilities.ts` conversion; retain/adopt per endpoint and modality | Required existing conversion SDK-04; I6 decision pending, I-09 if adopted |
| Provider streaming errors / retries | Key/model failover vs mid-stream provider retries; partial output and side effects | Required existing behavior SDK-03; planned R2 adoption, R-02–04 |
| UI snapshots, active/data parts, cancellation/approval continuation, SSE heartbeat | Main stream/persistence, renderer overlay, Gateway SSE consumers; selected-release fixes versus main-only resume fix | Required R1/SDK-02/03/04/07; R-01/05/06/07; new heartbeat activation tracked in R3 |
| Native Tool Search / deferred loading | Request-selected catalogs, callback ranking/limit, direct invocation, UI/history compatibility | Planned phase 2, TS-01–09 |
| Code Mode / conversation catalogs / caller routing | Core adoption versus existing Pi native QuickJS/search/MCP; nested approval, results and prompt/catalog behavior | Planned phase 3, CM-01–10; Core activation remains a separate choice; native Pi maps to H2 |
| Harness adapters, sandbox, native auth, per-turn settings, steering, questions/callbacks, history | Existing host/driver boundary; Pi/Claude/DSH capability and lifecycle parity | Planned H1–H4 and full Harness matrix; resume is not transcript access or exactly-once recovery |
| Harness release/main fixes and Pi native dependency gap | ACP tool/input binding if selected; terminal telemetry, Claude cumulative cost; Pi 1.0/VCC versus older adapter dependencies | H1–H3 version ledger and black-box cases below; pending changesets are not released guarantees |
| Compaction and custom-loop boundaries | Reuse `compactModelMessages` / `inLoopCompaction`; tool pairing, summaries, attachment access and context budget | Required SDK-12; no new compaction subsystem or unpublished API assumption |
| Batch: tools, per-request models, image jobs, list/cancel/webhooks | Job identity, item/result correlation, durable destination and provider support | M1 decision pending; M-01 if adopted |
| Speech / transcription, including streaming | Inventory existing wrappers; capture/playback, transcript/file lifecycle, call attribution and tokens/characters/seconds | Existing callers required if found; M2 decision pending, M-02 including success/error/cancel and tracing opt-out |
| Speech translation | Source/target audio/text, ordering and interruption | M3 decision pending, M-03; distinct from existing text translation |
| Async video and reference inputs | Task identity, poll/webhook, cancellation, download and persistence | M4 decision pending, M-04 |
| Realtime Live | Transport, credentials, media permissions, queues, host tools/approval/context | M5 decision pending, M-05 |
| Evaluation and evaluation telemetry | Dataset/consumer, typed questions, shared state, result records and tracing | Q2 decision pending, Q-01; does not replace black-box validation |

Before starting a workstream, expand its provider/caller matrix against the implementation SHA. Before
closing the program, resolve every decision-pending row as adopted or explicitly deferred with a reason,
tracking record and revisit trigger. An unresolved row cannot disappear into a cleanup milestone.

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

| Existing runtime | Upstream starting point | Required evidence before replacement |
|---|---|---|
| Claude Code | Official adapter, sandbox bridge; approval, filtering, and steering surfaces exist | Local filesystem/process bridge works in packaged Electron; steer consumption and message ordering, background work, fork/edit, native session recovery, and live policy changes preserve the Cherry contract |
| Pi | Official adapter, native runtime in the host process | Selected provider/model and credentials, tool approvals, skills, steering, compaction, fork/edit, and close/reopen behavior work through the real adapter |
| DSH | No official DSH adapter in the checked catalog; Deep Agents is a different runtime | Establish an upstream/custom adapter route; use generic ACP only if DSH exposes a compatible endpoint and the necessary semantics survive it. Goal rounds, autonomous output, fork checkpoints, and approval behavior remain required |

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

## Compaction and file handling

Reuse existing compaction rather than adding the June proposal's new compaction directory. The upstream
[generic compaction proposal](https://github.com/vercel/ai/issues/14017) remains open. A v7 prototype
must verify that context maintenance preserves tool call/result pairing and persisted summaries.

The current attachment boundary is `attachmentRouting.ts` → `materializeNativeFilePart`; the June
`services/remotefile` port recipe is obsolete. See the [updated file assessment](./large-file-upload-port.md).

## Sources

- [Upgrade assessment](./aisdk-v7-research.md) — versions, patches, packaging, and semantic migration boundaries.
- [Feature inventory](./aisdk-v7-feature-inventory.md) — released features and experimental constraints.
- [Fixed migration guide](https://github.com/vercel/ai/blob/ai%407.0.123/content/docs/08-migration-guides/23-migration-guide-7-0.mdx).

<details>
<summary>June 2026 proposal — historical rationale, not a current implementation checklist</summary>

The following text preserves the original proposal, including its then-current paths, measurements,
and decision statuses. The dated assessment above supersedes its version and adoption conclusions.

## Goal

One runtime serves chat **and** agent. No product-level chat/agent split. The runtime is an
*environment* over an unobservable model, with exactly two control surfaces:

- **`C` — context engineering** (the only input-side lever): system prompt, history, tool set,
  knowledge/MCP injection, compaction.
- **`G` — safety gate** (the only output-side lever): allow/ask/block, on side-effecting actions only.

The loop is **emergent** from the model's tool-calling, not driven by the runtime. Chat vs Agent
differ only in *how `C` is assembled* (user toggles live vs a saved preset). See the formal basis in
the design discussion; full architecture in [`architecture.md`](./architecture.md).

## Where we are (measured, current `main`)

Two parallel stacks, both real:

| | Chat | Agent |
|---|---|---|
| Entry | `AiStreamManager` → `AiService.streamText()` | `AgentSessionRuntimeService` → `runtimeDriverRegistry` |
| Loop | `src/main/ai/runtime/aiSdk/` — **AI SDK `ToolLoopAgent`, model-agnostic** | `runtime/claudeCode/ClaudeCodeRuntimeDriver` — CLI black box, Anthropic-only |
| Data | `schemas/message.ts` | `schemas/agentSessionMessage.ts` |
| Safety (`G`) | per-tool | `runtime/claudeCode/ToolApprovalRegistry.ts` — trapped in the claudeCode driver |

The model-agnostic loop **already exists and ships** (chat path). The fork is that agents don't use
it — they go through the claudeCode black box. `runtimeDriverRegistry` is the seam; `aiSdk` just
isn't registered as an agent-session driver yet.

## Decision log

| # | Decision | Rationale | Status |
|---|---|---|---|
| **D1** | **Stay on `ai@6` for this migration.** v7 is not a prerequisite. | v6 has the primitives we need: `ToolLoopAgent`, `prepareStep`, `runtimeContext`, approval via `needsApproval`+message-flow (centralized `toolApproval` setting + `toolsContext` are v7 — `G` wires via `needsApproval` on v6). v7 = provider-major churn + 6 patches + a silent `usage`-semantics flip. Details in [`aisdk-v7-research.md`](./aisdk-v7-research.md). | locked |
| **D2** | **Do NOT migrate to `@ai-sdk/harness` / claude-code harness.** | It's an experimental wrapper *on top of* the same `claude-agent-sdk` we already use; it **mandates a sandbox** and the claude-code adapter needs a port-capable sandbox (→ Vercel Sandbox, cloud) — architecturally wrong for a local Electron app that must touch the user's real FS. And it pushes toward "collect more black-box CLIs", the opposite of our unification. | locked |
| **D3** | **Runtime = environment with two levers `C` and `G`; loop emergent; no `mode: chat\|agent` enum.** | Implicit state transitions are unobservable; the only legitimate control is at I/O boundaries. | locked |
| **D4** | **`prepareStep` red line:** only (a) context maintenance and (b) safety-driven tool removal. Never `toolChoice`, phase orchestration, or workflow editorializing. | Steering an unobservable state machine degrades output. | locked |
| **D5** | **Three collapses:** (1) register `aiSdk` as an agent-session driver, demote `claudeCode` to one optional driver; (2) one message store (ModelMessage canonical, blocks derived); (3) lift `G` out of `claudeCode/` into a driver-agnostic `runtime/permission/`, consumed via native `toolApproval`. | Net LOC down; removes the fork at runtime, data, and safety layers at once. | locked |
| **D6** | **Steer = abort+restart (keep); Approval (`G.ask`) = serializable suspended-turn state (change).** | Both "yield to user", but steer = user changed their mind (discard+redo), approval = turn still valid, waiting on a permit (freeze+continue). Borrowed from HarnessAgent's `suspendTurn`/`continueGenerate`; see [`tool-approval-state-consolidation.md`](https://github.com/CherryHQ/cherry-studio/blob/13252a526ce01e9406c90b3492f1150706374eb5/v2-refactor-temp/docs/ai/tool-approval-state-consolidation.md) and [`steer-state-machine-consolidation.md`](https://github.com/CherryHQ/cherry-studio/blob/13252a526ce01e9406c90b3492f1150706374eb5/v2-refactor-temp/docs/ai/steer-state-machine-consolidation.md). | proposed |
| **D7** | **Session API borrows from harness:** typed `resume(session)` vs `continue(turn)` handles (distinct serializable states); whole session state = a serializable value (no hidden in-memory state); lifecycle verbs detach(warm) / stop(resumable) / destroy(terminal). | Recoverability across window-close/restart/crash; HITL approval survives process lifecycle. *Do not* borrow workflow-harness slicing/timeout (serverless-only). | proposed |

## Deferred to the eventual v7 upgrade (gated on D1)

Not part of the unification work; tracked here so the v7 bump has a concrete deletion list.

- **Forward the whole `AgentLoopHooks` family natively to the Agent; delete all the synthesis.** This is
  bigger than just one shim. Verified callback surfaces: v6 `ToolLoopAgentSettings` exposes **only**
  `onFinish`+`onStepFinish`, so Cherry's `Agent.ts` synthesizes the rest three different ways —
  `onStart`/`onFinish` hand-called via `safeCall` (and `onFinish` is success-only, **bare payload**),
  `onError` on the catch path, and `onToolExecutionStart/End` via `wrapToolsWithExecutionHooks`
  (`runtime/aiSdk/loop/internal.ts`, brackets each `tool.execute`). **v7 `ToolLoopAgentSettings` gains the
  full lifecycle family** — `onStart` / `onStepStart` / `onStepEnd` / `onEnd` / `onToolExecutionStart` /
  `onToolExecutionEnd`. So at v7:
  - `onStart` synthesis → native `onStart`; `onFinish` synthesis → native **`onEnd`** (which carries
    `{steps, finalStep, usage, responseMessages}` — Cherry's synthesized `onFinish` is bare); `onStepFinish`
    → `onStepEnd` (rename); `onToolExecutionStart/End` → native (delete `wrapToolsWithExecutionHooks`).
  - **Keep `composeHooks` + `AgentLoopHooks`** — the SDK gives one callback slot per kind; Cherry fans in N
    contributors (persistence / renderer stream / telemetry). The fan-in stays; only the *synthesis* goes.
  - **Stays stream-handled (not on the Agent even in v7):** `onChunk` and `onAbort` are `streamText`-only
    (absent on `ToolLoopAgent` — verified grep=0). Cherry keeps observing chunks via the AiStreamManager
    tee (it transforms/broadcasts/persists, so a tee beats `onChunk`) and abort via the `{type:'abort'}`
    part (the v6 do-now cleanup above). `onError` also stays catch-synthesized (not in Agent settings).
  - Corollary: **don't drop the Agent for raw `streamText`** to chase callbacks — v7's Agent already
    exposes the lifecycle family; only `onChunk`/`onAbort` differ, and those Cherry handles via the stream.
- **Telemetry → `@ai-sdk/otel`.** v7 removes the per-call `tracer` field; the tracer + `enrichSpan`
  move onto an `OpenTelemetry` integration, and per-call you pass `telemetry.integrations` (takes
  precedence over any global registration). Migration, concentrated in two files:
  - `runtime/aiSdk/params/buildTelemetry.ts`: stop building a per-request `AdapterTracer` as
    `telemetry.tracer`. Instead return `telemetry.integrations: [new OpenTelemetry({ tracer, enrichSpan })]`,
    and move the request-scoped `topicId`/`modelName` from the tracer constructor into `enrichSpan`
    (reading `runtimeContext` — aligns with `C`) or `telemetry.metadata`.
  - **Use per-call `integrations`, do NOT `registerTelemetry` globally.** v7 telemetry is opt-out once
    registered globally; Cherry's gate (developer-mode + topicId → else `undefined`) only stays correct
    if "disabled" means "no integration on this call". Per-call integrations preserve current behavior
    exactly (return `undefined` → no spans).
  - `observability/adapters/aiSdk/aiSdkSpanAdapter.ts`: v7 emits `gen_ai.*` semantic-convention spans by
    default. Either register `LegacyOpenTelemetry` (keeps `ai.*`, adapter barely changes) or update the
    adapter to parse `gen_ai.*` (more standard — net positive).
  - Rename `TelemetrySettings`→`TelemetryOptions`, `experimental_telemetry`→`telemetry` (codemod
    `rename-experimental-telemetry-to-telemetry` + type). Add `@ai-sdk/otel` dep.
  - **Unaffected:** the Claude Code OTLP bridge (`observability/adapters/claudeCode/*`) — that's the
    `claude-agent-sdk` CLI's own OTLP, not the `ai` package's telemetry. Leave as-is.
  - Dividend: `@ai-sdk/otel` also emits performance metrics via gen_ai semantics.

### Full official v6→v7 checklist

The official path is `npx @ai-sdk/codemod v7` (`--dry` to preview, `upgrade` for all majors). It's the
**only** automated tool. Three segments:

**Segment 1 — codemod-automated 🤖 (mechanical renames)**

| Change | Codemod | Cherry hits |
|---|---|---|
| `onFinish`→`onEnd`, `onStepFinish`→`onStepEnd` | `rename-on-*` | `onStepFinish` 9 files |
| `experimental_onToolCallStart/Finish`→`onToolExecutionStart/End` | `rename-experimental-on-tool-call-*` | (see hook shim above) |
| `experimental_onStart/onStepStart`→ unprefixed; embed/rerank `on*Finish`→`on*End` | `rename-*` | — |
| `experimental_output/customProvider/generateImage/transcribe/generateSpeech/include`→ unprefixed | `rename-*` / `replace-experimental-output-with-output` | `experimental_output` 0 |
| `experimental_prepareStep`/`experimental_activeTools`→ unprefixed | `remove-experimental-*` | 0 (already clean) |
| `CallSettings`→`LanguageModelCallOptions & Omit<RequestOptions,'timeout'>` | `rename-call-settings-type` | `loop/index.ts` AgentOptions block |
| `stepCountIs`→`isStepCount` | `rename-step-count-is` | 3 files |
| `ToolCallOptions`→`ToolExecutionOptions`; `isToolOrDynamicToolUIPart()`→`isToolUIPart()` | `remove-tool-call-options-type`, `remove-is-tool-or-dynamic-tool-uipart` | audit |
| `system`→`instructions`; `fullStream`→`stream` | `rename-system-to-instructions`, `rename-full-stream-to-stream` | `fullStream` 5 files |
| `experimental_telemetry`→`telemetry` | `rename-experimental-telemetry-to-telemetry` | 3 files (+ telemetry plan above) |
| `experimental_context`→`context`(→`runtimeContext`) | `rename-experimental-context-to-context` | 17 files |
| `includeRawChunks`→`include.rawChunks` | `move-include-raw-chunks-to-include` | audit |
| image/media part → `{type:'file',mediaType,data}` | `replace-image-message-part-with-file`, `remove-media-content-part-type` | audit attachment render |
| `@ai-sdk/google-generative-ai`→`@ai-sdk/google` | `rename-google-generative-ai-to-google` | check imports |

**Segment 2 — manual, codemod can't (or can't fully) ✋ — DANGER**

- ⚠️ **`result.usage` semantics flipped** — now all-steps total; per-step moved to `result.finalStep.usage`; `totalUsage` deprecated. **No type error.** Cherry 3 files (`totalUsage`) — hand-audit usage observer + cost stats.
- **Top-level result props sink to `finalStep`**: `result.request`/`response`/`providerMetadata` → `result.finalStep.*` (top-level deprecated).
- **`step.response.messages` no longer accumulates** — each step carries only its own messages. Audit any persistence relying on accumulation.
- **Token detail relocations** (codemod exists but verify cost math): `usage.cachedInputTokens`→`usage.inputTokenDetails.cacheReadTokens`; `usage.reasoningTokens`→`usage.outputTokenDetails.reasoningTokens`; anthropic cache-creation (`replace-anthropic-cache-creation-input-tokens`, `replace-cached-input-tokens`, `replace-reasoning-tokens`).
- **`allowSystemInMessages` defaults `false`** — v7 rejects system role inside `messages` arrays (anti-injection). If Cherry puts system in `messages`, set it `true` or move to `instructions`. **Needs audit.**
- **Request/response bodies excluded by default** — opt in via `include`.
- **UI-stream helpers now stateless**: `result.toUIMessageStream()`→`toUIMessageStream({stream})` (Cherry 2 files); `result.toUIMessageStreamResponse()`→`createUIMessageStreamResponse()`; `pipeTextStreamToResponse()` deprecated.
- **`{type:'reasoning-file'}`** new message part (additive).

**Segment 1b — consolidation dividends (not renames — opt-in reshapes worth doing at v7)**

- **Unified reasoning control.** v7 adds a top-level `reasoning?: 'provider-default' | 'none' |
  'minimal' | 'low' | 'medium' | 'high' | 'xhigh'` (V4 spec `LanguageModelV4CallOptions.reasoning`,
  **v7-only** — not in v6). Each first-party provider maps the uniform effort to its native mechanism
  (Anthropic → `thinking`/`effort` via `resolveAnthropicReasoningConfig`, OpenAI → `reasoningEffort`,
  Google → thinking budget). Explicit `providerOptions` still wins. Output unifies to `reasoning`
  parts + `reasoningText` + new `reasoning-file`. It's a `C`-side knob → fits "uniform, minimal".
  - **Can retire (first-party only):** the *effort/enable* parts of `qwenThinking.ts`, `noThink.ts`,
    `openrouterReasoning.ts` → collapse to one `reasoning` option.
  - **Keep:** `reasoningExtraction.ts` (output-side — strips inline `<thinking>` from the text channel
    via `extractReasoningMiddleware`; unified API governs the *request*, not whether a provider emits
    structured reasoning) and `skipGeminiThoughtSignature.ts` (transport quirk).
  - **Caveat:** unified effort is only reliable for providers implementing the V4 mapping. Cherry's
    many custom / openai-compatible providers may still need per-provider handling — don't assume the
    knob reaches them.

**Segment 3 — environment / structural 🏗️ (no codemod — the real cost)**

- Node ≥ 22 (Cherry ✅) · CJS removed, ESM-only (verify main-process build).
- **Provider V4 spec**: `@ai-sdk/provider` 3→4, all provider packages jump a major. The guide barely
  mentions this but it's the long pole: Cherry's **6 `@ai-sdk/*` patches + openrouter** are pinned to
  v3.x and must be re-derived against V4. Not codemod-able. See [`aisdk-v7-research.md`](./aisdk-v7-research.md).

**Net official path:** (1) run codemod → Segment 1; (2) hand-audit the ✋ danger items + UI helpers;
(3) re-derive 6 provider patches + verify ESM build. (1) is cheap, (3) is the work.

## Phased plan

Each phase is a self-contained, independently-shippable scheme, reversible behind the registry/flag.
Phases are ordered by dependency; later phases consume earlier ones. File paths are under `src/main/ai/`
unless noted.

---

### Phase 1 — Centralize `G` into one `PermissionEngine`, retire per-tool `needsApproval`

> Full scheme with current-state map, v6/v7 wiring, and deny handling: [`tool-approval-refactor.md`](./tool-approval-refactor.md).

**Problem.** The approval *decision* (`G`) is scattered across three places with no single function:
`src/shared/ai/claudecode/toolRules.ts` (`resolveClaudeToolInvocationAccess` → auto/prompt, for claudeCode),
`src/shared/ai/tools/mcpSourcePolicy.ts` (MCP source allowlist, baked into each tool's `needsApproval`), and
builtin tools (no `needsApproval` → implicit auto, **not permission-mode-aware**). `needsApproval` is per-tool,
boolean-only, and MCP-source-only — exactly what v7 deprecates. The two paths also use different *mechanisms*
(aiSdk = SDK-native message-based via `needsApproval` → `tool-approval-request` part; claudeCode = in-memory
`ToolApprovalRegistry` pause-and-await), but that's a mechanism concern, not `G`.

**Approach.** One `src/main/ai/runtime/permission/PermissionEngine.ts`:
`evaluate({toolName, input, runtimeContext}) → {verdict: 'allow'|'ask'|'deny', reason?}`, **folding** toolRules +
mcpSourcePolicy + builtin defaults + permission_mode. Driver- and tool-set-agnostic (aiSdk tools become
mode-aware — closes a gap). No OPA — hand-rolled by consolidating existing logic; **net code down**. Repoint the
gate-read sites (`tools/adapters/aiSdk/isApprovalGated.ts`, the `toolInvoke.ts` guard, claudeCode `canUseTool`) to
the engine. Wiring: **v6** keeps `needsApproval` only as a uniform delegation shim
(`(input,opts)=>engine.evaluate(...).verdict==='ask'`); deny routes to the availability layer (claudeCode
`{behavior:'deny'}` / aiSdk tool-exclusion). **v7** replaces the shim with one `toolApproval` function = the engine
(3-way maps 1:1 to `ToolApprovalStatus`).

**Files.** New `runtime/permission/PermissionEngine.ts`. Edit `tools/adapters/aiSdk/{isApprovalGated.ts,
mcp/mcpTools.ts}`, `runtime/claudeCode/settingsBuilder.ts` (`canUseTool`), folding in `shared/ai/claudecode/toolRules.ts`
+ `shared/ai/tools/mcpSourcePolicy.ts`. The claudeCode `ToolApprovalRegistry` is a **mechanism** detail — it stays
(consuming the engine's decision) until the aiSdk driver replaces claudeCode (Phase 2/5); it is *not* `G`.

**Steps.** (1) Build `PermissionEngine`, fold the three decision sources. (2) Repoint gate-read sites to it.
(3) v6 wiring: uniform `needsApproval` delegation shim + deny via availability layer. (4) (v7) swap the shim for a
single `toolApproval` function.

**Verify.** Approval behavior identical on both paths (manual: write/bash tool still gates); a built-in tool now
respects `permission_mode`; the same `PermissionEngine` decision drives claudeCode and aiSdk.

**Risk / rollback.** Low–medium — behavior-preserving consolidation. Rollback = revert to the scattered reads.
**State authority unchanged:** the DB message-part approval state ([`../tool-approval-state-consolidation.md`](https://github.com/CherryHQ/cherry-studio/blob/13252a526ce01e9406c90b3492f1150706374eb5/v2-refactor-temp/docs/ai/tool-approval-state-consolidation.md))
is untouched — this phase changes *who decides*, not *where it's stored*.

---

### Phase 2 — Register `aiSdk` as an agent-session driver

**Problem.** `runtimeDriverRegistry` (`runtime/registry.ts`) only has `ClaudeCodeRuntimeDriver` registered
(`runtime/claudeCode/register.ts`). `AgentSessionRuntimeService.getAgentSessionDriver(agentType)` therefore
always returns the Claude Code black box → agents are Anthropic-only. Chat already runs the model-agnostic
loop (`runtime/aiSdk/`) directly via `AiService.streamText`; agents just don't reach it.

**Approach.** Implement the `AgentSessionRuntimeDriver` interface (`runtime/types.ts`) backed by the
existing aiSdk loop, register it, and flag-route agents to it. Map the driver surface onto the loop:
`connect()` → start a stream from `Agent.ts`+`loop/`; user input → next `run()`; policy update → the
Phase-1 `toolApproval`; trace context → telemetry. Keep a minimal driver first (no warm pool / no steer
parity) so the surface is small.

**Files.** New `runtime/aiSdk/AgentSessionDriver.ts` (implements `AgentSessionRuntimeDriver`), new
`runtime/aiSdk/registerAgentSession.ts` (`runtimeDriverRegistry.register(new AiSdkRuntimeDriver())`).
Modify `runtime/index.ts` to import the registration; `AgentSessionRuntimeService.ts` to pick the driver
by a per-agent flag. Persistence stays on `AgentSessionMessageBackend` until Phase 3 (don't change two
things at once).

**Steps.** (1) Map each `AgentSessionRuntimeDriver` method to the aiSdk loop. (2) Wire `G` via Phase-1
`runtime/permission/toolApproval.ts`. (3) Add a per-agent `driver: 'claudeCode' | 'aiSdk'` flag, default
`claudeCode`. (4) Route one test agent to `aiSdk`.

**Verify.** An agent whose model is **non-Anthropic** (e.g. a Gemini or OpenAI model) runs a full
multi-step tool loop end-to-end: tool call → approval gate → result → continue → finish. Approval works;
trace spans land. Existing Claude Code agents (flag default) are untouched.

**Risk / rollback.** Medium — the driver surface is broad (warm/idle/steer/policy). Mitigation: ship the
minimal driver behind the per-agent flag; only opt a test agent in. Rollback = flag back to `claudeCode`.

---

### Phase 2a — Context model (the `C` surface)

**Problem.** Context is injected as one fat `RequestContext` blob via `experimental_context`
(`tools/adapters/aiSdk/context.ts`), unpacked per tool by `getToolCallContext(options)` which **throws**
if it's missing. `sessionId` and `workspace` live only in the claudeCode driver and never reach tools —
the context layer is forked the same way the runtime is. AI SDK actually offers three orthogonal layers
(all present in `ai@6`; the `experimental_context`→`runtimeContext` rename is the only v7 delta):

| Layer | What | When | Validation |
|---|---|---|---|
| `CALL_OPTIONS` (`callOptionsSchema`+`prepareCall`) | typed args to a parameterized preset → expanded to prompt/settings | before the loop | `callOptionsSchema` (zod) |
| `runtimeContext` | ambient request/session state, read by tools+callbacks, mutable per-step | during the loop | typed generic |
| `toolsContext` | per-tool **isolated** deps, map keyed by tool | at tool execute | per-tool `contextSchema` (**v7-only**) |

**Approach — robustness frame: one construction point, one trust boundary.** All three are built in **one**
place in main (the `buildAgentParams` successor), from IPC-validated inputs. The untrusted renderer sends
only serializable, schema-validated data; main injects the non-serializable capabilities (abortSignal,
service handles, scoped MCP capabilities) which **never cross IPC**. Tools read `options.context` directly
and never construct or guard context. Three incremental steps:

- **Step 1 (pure v6, rides Phase 2): enrich `runtimeContext` + fail-fast.** Replace the throw-on-missing
  pattern with one validated construction point. New shape:
  ```ts
  interface CherryRuntimeContext {
    requestId: string
    topicId?: string              // chat
    sessionId?: string            // agent session  — was claudeCode-only
    workspace?: { path: string }  // agent cwd       — was claudeCode-only
    assistant?: Assistant
    // drop abortSignal — ToolExecutionOptions.abortSignal is native
  }
  ```
  Freeze identity fields (`requestId`/`sessionId`/`topicId`/`workspace`); `prepareStep` may only mutate a
  designated mutable slice (e.g. compaction state). This closes the claudeCode/aiSdk context fork (both
  drivers map *from* this one shape). **Worked example — `tools/adapters/aiSdk/builtin/` (PLAN ONLY, not yet
  applied):** the 4 builtin tools hand-roll context plumbing for nothing.
  - `WebSearchTool`/`WebFetchTool` use only `abortSignal`, which is native → drop the
    `import { getToolCallContext }` and write `execute: async ({ query }, { abortSignal }) => searchWeb(query, abortSignal)`.
    (Verify `options.abortSignal` is the call-level signal derived from the request signal — equivalent.)
  - Stop threading the whole `Assistant`; inject only `knowledgeBaseIds`. The `isRequestContext`+throw in
    `context.ts` exists only because `experimental_context` is `unknown`-typed — with one owned shape it
    becomes a build-time guarantee.

- **Step 2 (v7, gated by Phase 1 / `G`): `toolsContext` isolation for MCP + workspace tools.** Today an MCP
  tool's `execute` closes over `application.get('McpRuntimeService')` — any tool can reach any service.
  Build a **scoped capability handle per tool at registration**, keyed by stable `mcpToolIds` (from
  `ToolApplyScope`, not display name — names collide/rename), placed in `toolsContext`; the tool gets only
  `options.context`. Don't force simple built-ins into a schema. **Fix the subagent isolation breach:**
  `tool_invoke`/`tool_exec` forward `{...options}` (`meta/toolInvoke.ts`, `meta/exec/runtime.ts`) — once
  `toolsContext` exists, `options.context` is the *parent* tool's context; spreading it hands a child the
  wrong context. Re-resolve context by child tool name; narrow `toolsContext` to the granted subset.
  At this point `context.ts` (`getToolCallContext`/`isRequestContext`/`ToolCallContext`) is **deleted**;
  KB tools declare `contextSchema: z.object({ scopedBaseIds })` and read typed `options.context` (no throw,
  no `?? []` — `applies: knowledgeBaseIds.length > 0` already guarantees non-empty).

- **Step 3 (opportunistic): `CALL_OPTIONS` for parameterized presets.** A saved Agent/assistant preset =
  a `ToolLoopAgent` with `callOptionsSchema` (its typed knobs) + `prepareCall` (template expansion). `callOptionsSchema`
  doubles as the IPC-boundary validator for renderer-supplied options; `prepareCall` must be pure/non-throwing.
  Cleanest example = the translate flow (`{ targetLang }`). Division of labour: cross-cutting `C` (provider
  quirks, telemetry) stays in `buildAgentParams`+features; preset-specific `C` (instruction template, args)
  goes in `prepareCall`. Chat keeps `CALL_OPTIONS = never` → untouched.

**Files.** `tools/adapters/aiSdk/context.ts` (Step 1 reshape, Step 2 delete); `runtime/aiSdk/params/`
construction point (build the three contexts); `tools/adapters/aiSdk/builtin/*` (Step 1/2 reshape);
`tools/adapters/aiSdk/mcp/mcpTools.ts` + `meta/{toolInvoke,exec/runtime}.ts` (Step 2 scoped handle +
re-resolve); per-preset agent definitions (Step 3).

**Verify.** Step 1: chat + agent runs unchanged, no tool throws on missing context. Step 2: a malicious/
buggy MCP tool reaches only its own capability (write a test that asserts a tool's `context` excludes other
services); subagent child gets its own context, not the parent's. Step 3: a translate preset runs with a
typed `{ targetLang }`; chat path emits no `options`.

**Risk / rollback.** Step 1 low (v6, mechanical). Step 2 medium (isolation correctness — the subagent
breach is the sharp edge). Step 3 low (opt-in). Each step independent; rollback per step.

---

### Phase 3 — Unify the data model (one message store)

**Problem.** Two schemas (`data/db/schemas/message.ts` for chat, `data/db/schemas/agentSessionMessage.ts`
for agent) and two persistence backends (`streamManager/persistence/backends/MessageServiceBackend.ts` vs
`agentSession/persistence/AgentSessionMessageBackend.ts`). "chat vs agent" is baked into the data layer, so
history/restore/search/branch are implemented twice.

**Approach (resolves OQ2).** **Reference, don't fat-merge:** keep `message` as the single store and make an
agent session a topic-like container whose turns are `message` rows (linked by `sessionId`/`topicId`),
rather than copying every `agentSessionMessage` column into `message`. This preserves the branch DAG + FTS
that already live on `message`. Store content in **ModelMessage** shape (AI SDK native); `blocks[]` become
a **derived** UI projection computed on read (a selector), and FTS text is derived. Parameterize the
derived block types by the built-in `ToolSet` so built-in tool parts stay compile-time typed (MCP/dynamic
tools fall back to an untyped part — same boundary AI SDK draws).

**Files.** `data/db/schemas/{message,agentSession,agentSessionMessage}.ts` (add session linkage to
`message`; mark `agentSessionMessage` for removal). New migrator under `data/migration/v2/` copying
`agent_session_message` rows → `message`. Delete `agentSession/persistence/AgentSessionMessageBackend.ts`;
repoint `AgentSessionRuntimeService` persistence to `MessageServiceBackend`. Renderer block-derivation
selector.

**Steps.** (1) Schema: link agent sessions to `message` rows. (2) Migrator copies existing rows (with a
backfill-count verification). (3) Repoint agent persistence to `MessageServiceBackend`. (4) Derive `blocks[]`
on read. (5) Drop the old table + backend once parity proven.

**Verify.** For a chat topic and an agent session: load, restore, full-text search, and branch-DAG
navigation behave identically. Migrator copies every existing agent row (assert source count == dest count).

**Risk / rollback.** **High — the only data-migration phase.** Mitigation: keep `agentSessionMessage` until
the migrator + dual-read parity is proven; gate the table drop on a separate later change. Rollback = keep
reading the old table.

---

### Phase 4 — Compaction (the missing piece of `C`)

**Problem.** The SDK provides **no** compaction on the `ToolLoopAgent` path (verified: only `HarnessAgent`
*sessions* expose `compact()`). Cherry manages context length manually today. Long agent sessions overflow
the window.

**Approach.** Build compaction as a `prepareStep` contributor — and **only** there (the `C`-maintenance
lever; red line D4: never `toolChoice`). Layered, ship the safe layer first:
- **Layer 1 — micro-trim (zero API cost):** truncate oversized tool outputs, merge adjacent same-tool
  results. Pure function over messages.
- **Layer 2 — auto-summarize (gated):** when `usage` crosses a threshold, keep system prompt + recent N
  turns + a generated summary of the middle. The summary model is **any** configured model (Cherry's
  advantage — can use a cheap model).
- Layer 3 (full compaction + selective file re-injection): deferred.

**Files.** New `runtime/aiSdk/context/compaction/{microTrim,autoSummarize}.ts`. Wire as a `prepareStep`
contributor via the existing `composeHooks` prepareStep fan-in (`runtime/aiSdk/params/composeHooks.ts`).
Threshold read from step `usage`.

**Steps.** (1) Layer 1 contributor (always on, safe). (2) Layer 2 contributor behind a flag, with model
selection. (3) Wire both into `prepareStep`. (4) Tune threshold.

**Verify.** A session exceeding the context window stays coherent; `prepareStep` emits no `toolChoice`
(assert in test); measured token usage drops at the threshold.

**Risk / rollback.** Medium — summary quality (Layer 2). Mitigation: Layer 1 alone is safe and already
useful; Layer 2 behind a flag. (OQ3 = how many layers to ship first → recommend Layer 1+2.)

---

### Phase 5 — Approval-as-suspended-state + demote claudeCode

**Problem (D6/D7).** Tool approval today is an in-memory awaited promise → lost on window-close / app
restart / crash. And the claudeCode driver is still the only "real Claude Code" path.

**Approach.** Make `G.ask` produce a **persisted, serializable `awaiting_approval` turn state** (the
suspend/continue model borrowed from HarnessAgent's `suspendTurn`/`continueGenerate`): freeze the in-flight
turn non-destructively, persist the cursor, resume on the approval decision. Keep **steer = abort+restart**
(D6) — steer discards and redoes (user changed their mind); approval freezes and continues (turn still
valid, waiting on a permit). Once the aiSdk driver reaches parity, flag it default-on and make claudeCode
opt-in or delete it.

**Files.** Persistence for the suspended-turn state (a column/table on the session/message). The `G.ask`
emit path in `runtime/permission/`. The resume path on approval. Reconcile with the existing
`pendingTurns`/queue + warm manager (OQ4). The per-agent driver flag (Phase 2) flips default.

**Steps.** (1) Define the serializable `awaiting_approval` state. (2) Persist it on `G.ask`. (3) Resume on
approval decision. (4) Reconcile with the existing queue so there's **one** state machine, not two (OQ4 —
resolve first). (5) Flip the aiSdk driver default-on. (6) Demote/delete claudeCode (OQ5).

**Verify.** Approve a tool, kill the app, reopen → the approval is still pending and continues correctly.
aiSdk driver at feature parity with claudeCode for a representative agent.

**Risk / rollback.** **High — touches the steer/queue state machine.** Hard dependency: OQ4 must be decided
before step 4. Rollback = keep in-memory approval + claudeCode default.

## Independent v6-now cleanups (not phase-gated, ship anytime)

These use APIs already in `ai@6`; they don't need v7 and aren't blocked by the phases.

- **Abort terminal via `onAbort` / `{type:'abort'}` part** (v6 has both). Today `AiStreamManager.runExecutionLoop`
  (`streamManager/AiStreamManager.ts:1050-1075`) infers the terminal post-hoc from `signal.aborted` + `result.threw`
  + `result.streamErrorText` — two separate `if (signal.aborted)` branches, `!signal.aborted` serialization gating,
  and a `if (exec.status==='streaming') exec.status='aborted'` promotion hack for the idle-timeout path. The SDK
  emits a dedicated `{type:'abort'}` terminal part (and `onAbort({steps})` fires while `onFinish` does **not** —
  mutually exclusive). Fix: have `pipeStreamLoop` read the stream's terminal part and return
  `terminalKind: 'abort' | 'error' | 'finish'`, then a clean 3-way switch maps to the existing handlers
  (`onExecutionPaused` / `onExecutionError` / `onExecutionDone`). Deletes the dual `signal.aborted` inference + the
  idle-path status hack; `onAbort`'s `{steps}` gives partial state directly. **Abort is the hottest terminal**
  (steer = abort+restart, D6), so this cleans the most-traveled path. Does *not* replace the terminal handlers or
  the backgroundMode-pause policy — only the terminal *detection*.
- **Preserve structured info on in-stream error parts.** Error handling is otherwise well-aligned with v7
  and robust — thrown errors (pre-stream + broadcast) go through `serializeError` (`src/shared/utils/error.ts`)
  into the full `SerializedAiSdkErrorUnion` (`src/shared/types/error.ts`, ~18 error types with
  statusCode/isRetryable/responseBody/…), and the renderer reconstructs the type via guards. **But the
  in-stream path is lossy:** `Agent.ts` calls `result.toUIMessageStream(...)` early, so `pipeStreamLoop.ts:70`
  sees `{type:'error'}` parts already flattened to `errorText: string`; `errorFromStreamChunk` then yields a
  **message-only** `SerializedError`. So a *mid-stream* provider error (content filter / context overflow /
  dropped connection) loses `statusCode`/`isRetryable`/type — the renderer's type guards (retryable badge,
  401→`chat.no_api_key` i18n) don't fire for it. (Common errors — auth/rate-limit at request start — are
  *thrown*, so they stay rich; the gap is mid-stream-emitted errors only.) Fix, either: (a) pass an `onError`
  to `toUIMessageStream` that serializes the **full** error into `errorText` (not just `error.message`); or
  (b) consume the raw `result.stream` error parts (which carry `error: unknown`, the full object) in `Agent.ts`
  before flattening to UI chunks — more thorough, touches the Agent pipeline. v6, not v7-related.
- **Delete the v6 `wrapToolsWithExecutionHooks` shim** is v7-gated (see "Deferred to v7" above) — listed there, not here.

## Open decisions (each: options → recommendation)

- **OQ1 — `G` rule engine: hand-rolled vs `@ai-sdk/policy-opa`.**
  - *Hand-rolled* (`runtime/permission/PermissionEngine.ts`, a verdict function over rules): no new dep,
    full control, but we maintain the rule language.
  - *`@ai-sdk/policy-opa`* (declarative OPA/Rego, plugs into native `toolApproval`, in-process WASM works in
    Electron, fails closed, has shadow/audit mode): powerful + auditable, but **v7-only** and adds a Rego
    authoring surface.
  - **Recommendation:** ship Phase 1 hand-rolled (we're on `ai@6` per D1); design `PermissionEngine` so its
    verdict type matches `toolApproval`'s (`pass/ask/block` ↔ `approved/user-approval/denied`) so policy-opa
    can drop in later as one more rule source without reshaping callers. Revisit at the v7 bump.

- **OQ2 — Data merge shape.** *Decided in Phase 3:* `agentSession` **references** `message` rows (session as
  a topic-like container), not a fat column-merge — preserves the existing branch DAG + FTS on `message`.
  Open sub-question: exact linkage column (`topicId` reuse vs a dedicated `sessionId`) and its index impact
  on `MessageService` queries.

- **OQ3 — Compaction layers to ship first.** Options: L1 only (safe, zero-cost) / L1+L2 / all three.
  **Recommendation:** L1+L2 (Phase 4) — L1 alone rarely saves enough on long tool-heavy sessions; L2 behind
  a flag with a cheap summary model. Defer L3 (file re-injection) until there's a concrete overflow case.

- **OQ4 — Reconcile `suspendTurn` with the existing `pendingTurns`/queue + warm manager.** The risk: two
  state machines (the new `awaiting_approval` suspend/continue + the existing steer/queue). **Constraint:**
  steer stays abort+restart (D6); approval becomes suspend+continue. **Open:** whether the existing
  `pendingTurns` queue can host the `awaiting_approval` state as one more queue state (preferred — single
  machine) or needs a parallel store. Must be resolved **before** Phase 5 step 4. Cross-ref the in-tree
  designs [`steer-state-machine-consolidation.md`](https://github.com/CherryHQ/cherry-studio/blob/13252a526ce01e9406c90b3492f1150706374eb5/v2-refactor-temp/docs/ai/steer-state-machine-consolidation.md) and
  [`tool-approval-state-consolidation.md`](https://github.com/CherryHQ/cherry-studio/blob/13252a526ce01e9406c90b3492f1150706374eb5/v2-refactor-temp/docs/ai/tool-approval-state-consolidation.md).

- **OQ5 — Keep the claudeCode driver after parity?** Options: keep as a "run *real* Claude Code in a
  sandbox" power feature / delete once aiSdk reaches parity. **Recommendation:** keep behind the per-agent
  flag short-term (zero cost once it's just one registered driver), delete when no agent selects it. Don't
  block Phase 5 on the deletion.

## Background facts (so this doc stands alone)

- **AI SDK version (D1):** Cherry is on `ai@6.0.143`. v7.0.0 is stable but the upgrade carries: every
  `@ai-sdk/*` provider jumps a major (V4 spec); **6 `@ai-sdk/*` patches + openrouter** pinned to v3.x must
  be re-derived (the long pole, not codemod-able); and a **silent `result.usage` semantics flip** (now
  all-steps total; per-step moved to `result.finalStep.usage` — no type error). The `(C,G)` primitives we
  need are all in v6: `ToolLoopAgent`, `prepareStep`, `runtimeContext`, and approval via `needsApproval` + the
  message-based request/response flow. (The **centralized `toolApproval` setting is v7-only**; on v6 our `G`
  wires via `needsApproval` — see [`tool-approval-refactor.md`](./tool-approval-refactor.md).) So the unification
  does **not** require v7. Full upgrade checklist is the "Deferred to the eventual v7 upgrade" section above.
- **Why not the v7 harness (D2):** `@ai-sdk/harness` (claude-code adapter) is an experimental wrapper on top
  of the same `claude-agent-sdk` we already use, **mandates a port-capable sandbox** (→ Vercel Sandbox,
  cloud) which is wrong for a local Electron app, and pushes toward collecting black-box CLIs — the opposite
  of unification. Its only borrowable idea (session suspend/continue) is captured in D6/D7 + Phase 5.
- **Companion docs in this folder:** [`architecture.md`](./architecture.md) (the `(C,G)` design + context
  model), [`aisdk-v7-research.md`](./aisdk-v7-research.md) (upgrade-cost analysis),
  [`aisdk-v7-feature-inventory.md`](./aisdk-v7-feature-inventory.md) (what's in v7). Related in-tree
  reviewer-guide designs (parent dir):
  [`tool-approval-state-consolidation.md`](https://github.com/CherryHQ/cherry-studio/blob/13252a526ce01e9406c90b3492f1150706374eb5/v2-refactor-temp/docs/ai/tool-approval-state-consolidation.md),
  [`steer-state-machine-consolidation.md`](https://github.com/CherryHQ/cherry-studio/blob/13252a526ce01e9406c90b3492f1150706374eb5/v2-refactor-temp/docs/ai/steer-state-machine-consolidation.md),
  [`agent-session-workspace.md`](https://github.com/CherryHQ/cherry-studio/blob/13252a526ce01e9406c90b3492f1150706374eb5/v2-refactor-temp/docs/ai/agent-session-workspace.md).

</details>
