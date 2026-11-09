# Agent Note: Native steer delivery and reply ownership across agent runtimes

Status: proposed

English | [中文](2026-11-09-agent-native-steer.zh.md)

## Problem

At `27a61a606566fd60800e466ebfd041f858b89f9e`, Claude input already reaches the running Agent SDK Query through an asynchronous input stream. The [native owner](../../../../packages/agent-runtime-claude-code/src/owner.ts) maps `steer` to `priority: 'next'` and `follow-up` to `priority: 'later'`. The requested behavior is immediate native steering: send the new instruction into that Query with `priority: 'now'`, then display its response after the steer user message.

The installed `@anthropic-ai/claude-agent-sdk@0.3.311` declares all three priorities on `SDKUserMessage`. That establishes type support, not verified runtime timing. Changing the priority can expose `aborted_streaming` or `aborted_tools` intermediate results. The current [control projection](../../../../packages/agent-runtime-claude-code/src/control.ts) treats an active native result as terminal, and the [desktop driver](../../../../src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts) can translate it into an error or `turn-complete`. An intermediate result must not terminate the response that follows the steer.

This note owns native steer delivery for Claude Code, Pi, and Pi Durable, and the resulting product reply boundaries. Claude needs a priority change; Pi and Pi Durable already submit native steer and require timing and ownership verification rather than an invented `now` flag. It complements the [runtime ownership proposal](../simplification/2026-11-05-agent-runtime-boundary-ownership.md) and [content protocol](../simplification/2026-10-29-agent-runtime-content-protocol.md); their input identity, reply ownership, observation drain, persistence, and accounting contracts remain authoritative. This is a proposed behavior change, not a claim of completed runtime or Electron verification.

## Proposal

### 1. Use each runtime's native steer

The shared product contract is: submit steering input to the active native execution, preserve its identity, and display its response after the placed user input. Sending establishes an immediate visual boundary for all three runtimes; receipt, native placement, and authoritative reply handoff remain distinct events. Native APIs provide different scheduling guarantees:

| Runtime | Existing submission | Planned change and native timing |
| --- | --- | --- |
| Claude Code | Async input stream into the running Query, currently `priority: 'next'` | Use `priority: 'now'`; verify SDK handling of active generation and tools. |
| Pi | `input.submit({ whenBusy: 'steer' })` maps to native prompt `streamingBehavior: 'steer'` | Preserve native steer; verify placement after the current assistant/tool round and before subsequent model work. |
| Pi Durable | `conversation.submit({ type: 'input', whenBusy: 'steer', ... })` | Preserve native steer; verify committed placement after the current tool round, or a subsequent run if normal completion wins the race. |

Pi and Pi Durable 1.4.0 do not expose Claude's `now` priority through these APIs. This proposal does not promise immediate token-level or in-flight tool preemption for them. If equal preemption latency across runtimes is required, first identify and propose the upstream API/loop change for a separate decision. Do not simulate it with Stop and replay, a second scheduler, or a renderer-only reassignment.

Map `steer` to `now` in the existing native owner. Preserve `follow-up` as `later`, the existing FIFO dispatch, input UUID correlation, and delivery facts. A dispatch acknowledgment does not prove that the model has consumed the input.

Do not add an `interrupt()` call, abort the Query, or resubmit the conversation. The SDK decides how immediate input affects generation and foreground tools. Keep the current SDK version initially; upgrade only if a reproducible probe establishes a version limitation, with the patch audit and separate dependency scope that requires.

The initial prompt must retain its context when a steer arrives during startup. Probe this ordering before implementing a workaround. If the SDK reorders admitted inputs, identify the upstream limitation before choosing a host-side gate; this proposal does not invent a delay or a second input scheduler.

### 2. Classify Claude intermediate results in the native owner

Use the existing input records and native request identity to distinguish a steer-induced segment result from explicit Stop, genuine failure, and final completion. An `aborted_streaming` or `aborted_tools` reason alone is insufficient. Preserve explicit interrupt intent and native correlation when deciding which result is intermediate; an old result must not settle a successor response.

Record the intermediate segment's content, input outcomes, and invocation usage exactly once. Keep the same Query available for subsequent observations. Do not emit a final product completion, error, or completed-response fork checkpoint for a result established to be an intermediate steer segment. Actual failures, explicit Stop, and connection loss still settle through their existing paths. Uncertain delivery stays uncertain and is not automatically resubmitted.

Keep native classification in the Claude runtime package. Main consumes the established control and input facts rather than parsing SDK result frames again. Reuse existing controls where they suffice; add no second source of terminality.

### 3. Preserve Pi and Durable native admission and completion

For Pi, retain `PiRuntimeConnection.redirect()` and the runtime package's mapping to `streamingBehavior: 'steer'`. The synchronous `input-placed` callback reserves product attribution before the next provider request; the captured observation's `placed` fact drives `steer-boundary`. Test both edges so early usage or content cannot precede reservation, and acknowledgment or `queued` alone cannot switch the visible reply. Native `followUp` remains a separate final-boundary policy.

For Pi Durable, retain the existing `conversation.submit` path and logical input ID in native entry metadata. `onInputPlaced` reserves attribution synchronously; input facts and foreground completion come from the same captured committed `ConversationView`. Main consumes those facts before corresponding content. Keep acceptance distinct from placement, do not replace committed observations with status polling, and do not interpret a native run's `done` alone as product success. Truncation, failed/aborted input, unresolved input, and pending background results retain their existing classifications.

For both runtimes, a steer submitted near normal completion must still be answered once according to the native late-input behavior. Several placed inputs can share an answer. Unknown admission and reconnect reconcile existing identities without resubmitting. Durable reopen must recover accepted input and its native placement/outcome; orderly reopen evidence does not prove process-kill recovery or exactly-once external tool effects.

Root steering is the direct-send path under review. Managed child input keeps the existing behavior entry's admission and continuation rules, including Durable's unsupported completed-foreground-child continuation. Do not bypass behavior with raw child prompts to make the runtimes appear identical. Observe continuing children and test root steer with child work in flight.

### 4. Provide immediate visual steering and retain the native reply boundary

All three runtimes provide visual `now` independently of native scheduling. Direct steer immediately shows its user row and a continuation assistant below it. Completed text and tools stay before steer; unfinished tools, processing activity and subsequent deltas appear in the continuation. Compaction anchors stay at their original message position even when completion arrives later. There is no separate waiting label. Stop remains available while the native loop continues.

The renderer records the local split against predecessor and user identities, without changing native message ownership or persisting duplicate content. Acknowledgment replaces the optimistic user identity without taking another snapshot. At native handoff, carried parts join the actual successor's display once; the predecessor does not expand back across the boundary. Rejected dispatch restores the original live view. Topic changes discard local boundaries. An observer or reload can derive an active boundary from current messages, but cannot reconstruct the exact earlier text cutoff without a persisted boundary; reload and multiwindow agreement remain unverified acceptance work.

Continue to derive `input-boundary` from native request membership, including `status: requesting`, before publishing the corresponding response content and usage. The [runtime service](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts) resolves input IDs and the [existing reducer](../../../../src/main/ai/agentSession/agentSessionRuntimeState.ts) owns the authoritative A1-to-A2 handoff:

1. Before native placement, content remains with its evidenced existing reply; offering a steer alone does not establish a new response.
2. At the input boundary, settle A1's delivery and reserve A2 after the steer user message, using the existing reply identity and persistence barrier.
3. Buffer A2 content during attachment, then deliver it to A2's stream. Late A1 tool results and usage retain their recorded ownership.

Several inputs may share a native response. Preserve that native placement rather than creating an empty assistant message for every click. New input, native placement, product reply completion, and background resource lifetime remain separate facts.

Renderer consumes message projections by message and execution identity and owns the visual segmentation above. Main continues receiving and persisting old deltas under A1 until their native boundary. Sending alone never changes output attribution or database terminal state. UI copy uses i18next and components follow the repository design system.

### 5. Respect native tool and Stop behavior

Immediate input may cancel foreground tools or leave work running according to SDK behavior. Project the observed outcome; do not label cancellation as success or keep a finished tool spinning. Preserve background child observation, result attribution, and the user's Stop entry while work still belongs to the product reply.

Do not silently move every foreground child to the background to avoid native cancellation. If real acceptance shows that such a policy is needed, record its effect on tools and child lifetime as a separate product decision. Stop during a steer transition still wins: no queued host launch or late callback may reopen the stopped reply.

### 6. Implement and verify in order

1. Record a baseline for all three pinned runtimes with a controlled slow stream/tool; for Claude repeat with `now`, and for Pi/Pi Durable record when their existing native steer is placed. Capture offered UUIDs, request membership, result reasons, input boundaries, response content, tool outcomes, and usage. Compare with real-provider sessions for each runtime; controlled-provider evidence does not establish real model instruction following. Report enqueue, placement, and first successor content separately instead of claiming that all runtimes preempt at the same point.
2. Change Claude priority and only the native result/control or Pi/Pi Durable admission handling demonstrated necessary by those traces. Extend existing runtime tests with the observed event sequences and failure cases.
3. Exercise the existing Main handoff with production SQLite migrations: predecessor persistence in flight, successor chunks arriving early, repeated steers, explicit Stop, and old callbacks. Correct only reproduced ownership defects.
4. Implement the shared visual boundary and its rejection/Stop reconciliation, then run isolated Electron acceptance with real providers on Claude, Pi, and Pi Durable. Verify visual handoff with native placement deliberately delayed; record that separately from first post-placement content. Inspect visible ordering and stored messages/usage, including a second observing window and a reopened session. Update the Claude package README's priority contract and any semantically affected references in the implementation layer.

Relevant existing test owners are `packages/agent-runtime-claude-code/tests/runtime.test.ts`, `packages/agent-runtime-claude-code/tests/projection.test.ts`, `src/main/ai/agentSession/__tests__/agentSessionRuntimeState.test.ts`, and `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.handoff.test.ts`. Pi owners also include `packages/agent-runtime-pi/tests/runtime.test.ts`; Durable owners include `packages/agent-runtime-pi-durable/tests/runtime.test.ts` and `packages/agent-runtime-pi-durable/tests/runMetadata.test.ts`. Include affected driver tests when their code changes. Run explicit file filters for changed owners and affected consumers. Record probe, focused test, Electron, real-provider, and CI results separately.

Ordinary Chat's AI SDK step-boundary continuation, native loop/scheduler redesign, schemas, and the general renderer transport are outside this change. The default implementation scope is Claude's priority/result handling plus the shared immediate visual boundary and reproduced steer defects in Pi/Pi Durable; passing native paths need acceptance evidence, not speculative rewrites.

### 7. UI implementation evidence

The shared Agent renderer shows optimistic steer input immediately and projects unfinished work into the assistant continuation after it. Completed predecessor content stays held, while native successor parts merge with carried work for display. Compaction anchors remain before steer. Native submission policies, persistence and result classification are unchanged.

Focused renderer tests cover held content, rejection recovery, handoff release, cross-topic reset, immediate user display, accepted-row deduplication, and affected list/parts/provider consumers. Controlled Electron verification supplies delayed-placement renderer state; it does not execute a native provider. Evidence for the simplified UI is recorded separately in the ignored `.context/cherry-electron-dev/steer-simple-evidence.json` and corresponding screenshots. This is partial AC12 evidence, not completion of per-runtime native, tool, multi-window, or persistence acceptance. The Spec remains proposed.


Subsequent real-provider Electron sessions used DeepSeek Flash through Claude Agent SDK, Pi, and Pi Durable. Pi and Pi Durable followed the placed steer after the running tool returned; ordinary queued messages then executed in order. All three runtimes completed manual compaction with input submitted while compaction was active, without an observed explicit interrupt or connection replacement during those scenarios. This does not verify Claude `now`, automatic compaction, or cancellation inside a native SDK. One Claude tool scenario continued the prior plan instead of following the steer. Pi accepted another steer while the first was still waiting, so a single pending-steer admission rule is not implemented.

The renderer also presents assistant rows containing only compaction anchors as standalone labeled separators. Empty paused rows use a centered interrupted separator; rows with substantive answers, reasoning, or tools retain their message frame. These are presentation changes over existing parts/status, not a new timeline or persisted event store. History reload and real Pi Stop scenarios were checked in Electron.

The waiting indicator has been removed. Main-owned admission for compaction, pending steer, and cross-session deliveries remains follow-up work. Local presentation is not evidence that a native runtime has consumed the new input.

## Alternatives considered

- Require a universal `now` flag: Pi and Pi Durable expose different native scheduling contracts; this would invent capability or require an unapproved upstream loop change.
- Keep Claude `next`: retains the current waiting behavior and does not meet immediate steer intent.
- Explicit Stop followed by a new request: adds cancellation and resubmission semantics to an operation already supported by the running Query.
- Change only the priority: risks interpreting an intermediate aborted segment as final failure or completion; native traces must establish whether result handling also needs repair.
- Reassign old deltas to A2 immediately on send: guesses placement and assigns old output to new input. Visual segmentation provides immediate feedback without changing native content ownership.
- Wait for native placement before any visual response: unnecessarily ties UI feedback to the runtime's model/tool scheduling latency.
- Ignore all aborted results: hides explicit Stop and unrelated failures, and can leave the session waiting forever.

## Acceptance criteria

- AC1 — Steering during a controlled active stream reaches the same native Query with `now` and can change its response before the original generation completes; real Claude acceptance confirms that the new instruction is followed. (verification: native SDK probe and Electron — implementation owner)
- AC2 — A correlated steer-induced intermediate aborted result preserves subsequent response delivery, while genuine errors and explicit Stop remain observable terminal outcomes. (verification: runtime regression tests and native SDK probe — implementation owner)
- AC3 — Post-steer content appears after the steer user message without lost or duplicated text; late prior-reply content and usage do not migrate to A2, including while A1 persistence is blocked. (verification: Main SQLite handoff tests and Electron — implementation owner)
- AC4 — Rapid consecutive steers preserve native input order and response membership without duplicate submission or fabricated empty replies; ordinary follow-up still waits with `later`. (verification: runtime regression tests and native SDK probe — implementation owner)
- AC5 — A steer sent during startup retains the initial prompt's context, and rejected or uncertain submission remains recoverable without automatic replay. (verification: native SDK probe and Main regression tests — implementation owner)
- AC6 — A steer during foreground tool or child work displays the actual native tool outcome, retains attribution of continuing child results, and does not strand a live indicator. (verification: native SDK probe and real Claude Electron acceptance — implementation owner)
- AC7 — Stop during the handoff prevents reply reopening; an old callback or connection-loss event cannot mutate a successor connection. (verification: Main handoff and reducer tests — implementation owner)
- AC8 — Two observing windows and a reopened session agree on the ordered saved messages, tool states, and usage, with each invocation accounted for once. (verification: Electron with SQLite inspection — implementation owner)

- AC9 — Pi native steer is placed before subsequent model work at its supported boundary, and the placed input's response reaches A2 without automatic interruption, duplicate input, or an early switch on acknowledgment; native follow-up remains distinct. (verification: Pi runtime tests, native probe, and real-provider Electron acceptance — implementation owner)
- AC10 — Pi Durable accepted steer survives a race with normal completion and orderly reopen, is answered once, and preserves captured placement/completion and usage; truncation and cancellation remain visible. (verification: Durable runtime/run-metadata tests, native probe, and SQLite/Electron inspection — implementation owner)
- AC11 — AC3 and AC5 through AC8 pass independently for Claude, Pi, and Pi Durable, with runtime-specific placement and tool behavior recorded; one passing runtime cannot substitute for another. (verification: per-runtime acceptance matrix — implementation owner)

- AC12 — Steer immediately shows its user row and continuation assistant, with unfinished tools, activity and later deltas below the input. Completed content and compaction anchors stay before it. Native handoff merges the visible continuation without duplicate parts or restoring late text above steer; rejection restores the live predecessor. Native attribution and submission are unchanged. Reload and second-window agreement require separate evidence. (verification: focused renderer tests and real-provider Electron acceptance — implementation owner)

## Risks

Claude SDK type support and Pi/Pi Durable native steer APIs do not establish event ordering, prompt obedience, or foreground tool behavior. Pi/Pi Durable may wait for a long native model/tool round; that is an explicit capability limit, not evidence of a renderer defect. The native probe is required before deciding that the priority edit alone is sufficient. Gateway/model behavior and SDK scheduling must be reported separately when traces cannot establish causality.

An intermediate result can race with explicit Stop, native placement, final persistence, and connection replacement. Classification must retain input/request identity and existing generation fencing; elapsed time and the latest visible message are not sufficient evidence.

The prior runtime ownership proposal records a Claude steer whose reply attribution passed while instruction following did not. This change must demonstrate both properties anew. Documentation checks and synthetic replay do not complete real Claude or Electron acceptance.
