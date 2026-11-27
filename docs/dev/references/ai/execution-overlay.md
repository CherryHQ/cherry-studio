---
description: Shared root and child message projections, bounded attachment recovery, and root overlay handoff
sources:
  - src/shared/ai/messageProjection.ts
  - src/main/ai/messages/MessageProjection.ts
  - src/main/ai/messages/AcceptedToolResults.ts
  - src/main/ai/messages/ProjectionSubscriptions.ts
  - src/main/ai/streamManager/TopicMessageProjection.ts
  - src/main/ai/agentSession/ChildThreadProjection.ts
  - src/renderer/services/aiTransport/MessageProjectionService.ts
  - src/renderer/hooks/useStreamCommands.ts
  - src/renderer/hooks/useHistoryReplies.ts
  - src/renderer/hooks/useTopicSpeech.ts
  - src/renderer/hooks/useTopicCompletion.ts
  - src/renderer/hooks/agent/useAgentChildProjection.ts
---

# Execution Overlay

## Ownership and message model

Chunk streams use `readUIMessageStream` in `pipeStreamLoop`. For Agent roots, `RootMessageProjection` applies content changes and holds live part values. `pipeMessageStream` reads execution controls and forwards accepted changes. `TopicMessageProjection` reads a message-shaped view from the root owner on attach and keeps the revision and pending patches between reads. Children use their native observation, local part updates and archive composition. Both paths send `CherryUIMessage` baselines and patches to the renderer.

For Agent content, `onPart` supplies an accepted change and `onMessageReconciled` supplies the affected source for recovery. Root and child publishers send a `type: 'parts'` frame with the target kind, revision and addressed patches. Run state travels in its own ordered update. The renderer commits all valid edits in a revision before notifying part subscribers. A revision gap or an invalid placement triggers a new attachment.

```text
Root message source → TopicMessageProjection ──┐
Child native observer → ChildThreadProjection ─┤
                                              ↓
                              MessageProjection / ProjectionSubscriptions
                                              ↓ ai.projection.*
                                   MessageProjectionService
                                    ↙                   ↘
                       useStreamCommands      useAgentChildProjection
```

A root baseline covers the current live overlay, not the topic's saved history. It includes execution, attempt and message-anchor identities, so parallel models and a retry using the same model/anchor stay distinct. The child baseline covers its own archive and current content; it excludes parent and sibling content. `toolCallId` resolves a child through its owner and is not the child's durable identity.

Concrete runtime observations capture body, aliases, retractions and live/history provenance
together. Main consumes that complete value instead of reconstructing delivery history or reading
mutable adapter metadata later. Each runtime connection discovers its children and owns their relationship, access and projection.
A relation-only observation leaves the child message view and its archive refresh schedule untouched. Closing joins native production and observation callbacks
before the final archive flush, then detaches and releases; backup holds that boundary until resume.

Native queues, child lifetime and persistence destinations remain owner-specific. Observing or detaching a view does not submit input, stop a task, or transfer native ownership. Parent completion does not finish a background child's projection. Native owner closure makes the child unavailable while retaining its readable archive.

Archive reconciliation can await a native read. It preserves submitted product user text
when behavior wraps the corresponding native input, and retains saved source mappings
when a later snapshot uses committed rather than live preview identities.
Explicit removals persist with the checkpoint and hide those sources after reopen;
absence from a compacted native view alone does not remove saved product history.

Child model-response errors become `data-error` parts alongside any received content. Each attempt's error
survives archive writes, later retries and reopening, including failures with no text. These message-local errors
do not determine the child's task status, which follows the native run outcome.

## Publication

`MessageProjection` coordinates subscriber delivery. Chat and child archive updates can supply a view for structural diffing. Agent roots send accepted part patches directly and publish a message replacement for structural reconciliation. `order` carries message membership or order changes. Unchanged messages and parts keep stable references in the renderer.

Claude Code, Pi and Pi Durable deliver addressed edits for root and child replies. `part-open` creates text or reasoning, `part-append` delivers a suffix, `part-finish` seals the block, and `part-correct` replaces its text or reasoning after a native correction. `part-add` creates a tool or data block. `part-put` updates an existing non-text block.

In a root reply, Main assigns a stable `partId` and the next archive `pos` to each new part. Native parts and host events such as compaction use the same allocator. After text A and compaction marker C, opening B appends it to give `[A, C, B]`. A late suffix for A updates A in place. The renderer appends newly admitted root parts to the row. Root checkpoints record each native source's part IDs so a reopened reply retains the same ownership and order even when C separates two blocks from one source. Existing checkpoints with offsets and counts remain readable.

Child projections currently compose native fragments using `afterPartId`. The child event names its predecessor, or opens the row when the predecessor is absent. The IPC event type binds these placement rules to the projection target.

One revision may carry several ordered edits. The renderer routes parts frames directly to its part store. Its structural reducer accepts only structural frames. Each path validates the whole revision before publishing its values. Text, reasoning and tool rows subscribe by projection target and part ID. A suffix wakes the affected row. Structural frames carry membership changes and detail invalidations. Main projects tool results with their archive message ID and stable part ID. Both the published value and its invalidation use that address. A merged child reply can therefore display a result whose archive row belongs to a different source.

Root recovery loads source mappings, part identities and approval facts. Reading a reply resolves its live and committed entries together. A successful part save releases its live payload, and a failed write leaves the payload available for terminal persistence. A completed root overlay reads the stored reply on demand. Child archive reconciliation carries the published part ID across native preview and committed identities. A successful write releases the matching preview output, including a retracted result. A newer live update to that part survives the older write.

Owners capture mutable native parts at acceptance and retain untouched accepted parts. A tool update captures its latest output and compact renderer part once; subsequent text batches reuse that accepted part instead of cloning, serializing or hashing the result again. A replacement supersedes the previous accepted result rather than retaining a value history.

Tool replacements publish a `tool-result` patch with the stable result reference. Part-aware references invalidate the corresponding detail cache by part ID. Covered revisions do not repeat invalidation. A gap requires reattachment and topic-detail invalidation. See [IPC Transport](./ipc-transport.md#tool-result-reads) for detail-read purposes and cache limits.

Consecutive Agent root appends to the same part coalesce over 80 ms. An attach flushes pending operations before reading the owner's current values and revision. Child reconciliation batches native updates and writes its archive before publishing a structural view. Closing flushes pending delivery before disposal. Revisions count published batches.

A root terminal is published in the notification phase, after terminal persistence. The final view includes accepted content, the final execution state and its owning `userMessageId` in the same revision. That identity correlates a queued submit's user-only acknowledgement with its later assistant attempt and recovery completion. Persistence failure publishes an `unresolved` execution with readable content and an error; it does not signal a successful DB handoff. Host-resolved approvals are folded into Main's snapshots so a later SDK snapshot cannot restore a dismissed approval card.

## Attachment and recovery

When Durable reopens during an unfinished placed input, its unique logical user-input boundary identifies committed output for the existing reply, including a tool-wait interval with no generation preview. A compaction summary inside the same Run keeps that input boundary open for its answer. Earlier answers and queued or ambiguous inputs remain historical. Recovery does not resend the input.

The root and child projection readers preserve stored tool-result references when loading their SQLite baselines. A tool detail request carries the stable `partId` through the renderer hook to the live or archived result reader. The reader allocates the live result's UTF-8 range buffer when requested.

`ai.projection.attach` accepts a topic or child target and a window-owned subscription ID. Main resolves the owner, registers delivery and captures a baseline without an asynchronous gap between registration and snapshot. A cancelled or replaced asynchronous attachment cannot install a listener. Window destruction removes its delivery leases.

The renderer listens before attaching and buffers up to 100 early updates. It installs the baseline, ignores covered revisions and applies only the next consecutive revision. A gap, invalid patch or buffer overflow starts a new attachment with a new subscription ID. Late responses and events from old subscriptions are ignored. This recovers the current view; it is not a durable event journal or a TCP-style retransmission protocol.

The store shares one transport subscription among consumers of the same target in a window. The last consumer detaches it. No renderer subscription controls the lifetime of native work. A remount reads the current baseline.

## Root rendering and DB handoff

Root pages read the topic projection through `useStreamCommands`. Mounted part readers receive addressed changes directly. Home and Agent Chat derive live rows for the selected branch. Quick Assistant keeps finished replies in its temporary conversation, and Selection reads the latest assistant reply.

A speech subscriber receives a baseline when it starts listening. A new text block carries its preceding text ID, even when the display anchor is a reasoning or tool block. A correction replaces the addressed text. Subsequent text appends carry the message ID, part ID, suffix, starting UTF-16 offset and turn origin. The offset lets the speech service recognize a duplicate from a second mounted consumer. Speech keeps only visible text for an eligible attempt.

- Update routing retains the execution attempt and anchor. A stale active-execution cache cannot overwrite a newer attempt.
- Finish callbacks occur once per observed attempt, including failure completion for `unresolved` attempts. Failed persistence settles recovery requests and reports errors while retaining readable output. Replayed or duplicate revisions do not repeat completion.
- Home and Agent Chat receive the stored message ID after a durable write. On completion or attachment, they read that row and replace its slot on the loaded branch page. History takes over when the current attempt has a readable terminal row. A pending placeholder, an outstanding approval, a page miss or a failed read keeps live content visible. Explicit exclusion by the selected branch hides the reply. A late read for a previous selection cannot complete the handoff.
- Quick Assistant clears its local replies on reset. Late frames from a cleared attempt stay hidden.
- Topic status and approval indicators still use the existing shared-cache status entries. Those entries do not contain the streamed body.

Home Chat, Agent Chat, Quick Assistant and Selection all consume this projection path. Their command hooks send input and stop requests separately; child input still goes through the owning runtime's child-message command.

## Related references

- [IPC Transport](./ipc-transport.md) — command and observation routes.
- [Stream Manager](./stream-manager.md) — execution, SDK accumulation and terminal persistence.
- [Agent Session Runtime](./agent-session-runtime.md) — session and child ownership.
