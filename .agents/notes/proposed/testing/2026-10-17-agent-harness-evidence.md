# Agent Note: Harness samples and runtime verification

Status: proposed

English | [中文](2026-10-17-agent-harness-evidence.zh.md)

## Problem

Methods named `prompt`, objects named `session`, and successful promises do not establish the same behavior across harnesses. A portable contract needs evidence for identity, admission, observation, interruption, ownership, and recovery. An adapter's missing operation also does not establish that its native harness lacks that capability.

This note preserves the runtime stack's five-sample research and verification record. It separates pinned source research, historical executed probes, current test coverage, and application acceptance. The [harness boundaries](../architecture/2026-10-17-agent-harness-boundaries.md) and [runtime contract](../architecture/2026-10-17-agent-runtime-contract.md) own the design; this note owns its evidence and acceptance gaps. The [subagent control proposal](https://github.com/CherryHQ/cherry-studio/pull/21578) owns changes beyond the implemented v0 contract. Migration does not mark that work implemented or establish new test results.

Implementation facts in this note refer to the cumulative runtime stack inspected at `bd6509eb5f71a9c6bbb57453f0a7ced25e92c766`. Behavior supplied by later layers remains a target at this layer; the note does not claim those features are already present here. Source links use that fixed snapshot, and notes not yet introduced link to their owning PR.

## Proposal

### Source baselines and evidence levels

Validate public guarantees against these five samples. The diagrams below illustrate relationships inferred from interfaces; they are not captured execution logs. Reading source or upstream tests is not evidence that those tests passed locally.

| Sample | Researched boundary | Pinned source baseline |
| --- | --- | --- |
| Pi | `pi-coding-agent` SDK, supplemented by RPC and the official subagent extension example | `earendil-works/pi@8efd314fa3d3232ce197d8d7a6a5660530b9d83e` |
| DSH | `dsh-agent`, `dsh-agent-loop`, `dsh-session`, and subagent plugins | `deepseek-ai/deepseek-harness@1600d8a1e140dcde43a1a0941940a0480712c011` |
| Pi Durable | The `pi-durable` Harness, Conversation, Submission, and Task | Same source baseline as Pi; a separate package and execution system |
| Codex | App Server v2 host protocol and its implementation | `openai/codex@ce0323f2f2d3b25e82806cd555237da3db4e1897` |
| ACP | The protocol contract when connecting to an ACP agent; v1, the v2 baseline, and experimental extensions are distinct | `agentclientprotocol/agent-client-protocol@e7dac67ac64ec7cf69079b3bb6eff46a21e026b3` |

Pi and Codex baselines come from the user-provided repositories; DSH and ACP were researched at fixed upstream commits. These baselines do not establish compatibility with Cherry's installed dependencies. In particular, the DSH research describes that upstream baseline, not Cherry's retired DSH integration.

ACP is an integration protocol, not an execution engine. The sample concerns harness behavior the protocol can express; each agent still decides its execution, storage, and extensions. The pinned baseline labels v2 as a whole draft; `schema/v2/schema.json` also differs from the unstable schema that adds experimental features. [ACP versions and migration](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v2/migration.mdx)

| Evidence | Version and limit |
| --- | --- |
| Current dependency and source inspection during migration | Cherry's desktop and Pi adapter target `pi-coding-agent` / `pi-ai` **1.3.0**; the Durable adapter targets `pi-durable` / `pi-ai` / `chord` **1.3.0**. Installed package manifests agree. The linked Pi repository is still at the pinned commit, whose coding-agent and durable packages are **1.3.0**. |
| Historical Pi offline probe | Ran directly against installed **1.2.0**, without Cherry's runtime wrapper, a model call, or an external tool. Its result stays a 1.2.0 result; this migration did not rerun it on 1.3.0. |
| Initial Pi Durable research | Durable had not yet been introduced to Cherry and the linked source checkout had no installed dependencies. Its upstream test references were static evidence. The adapter and its offline tests now exist; this does not retroactively turn that research into an executed upstream suite. |
| OAR comparison | Local baseline `141921ea5a818bd8b0a1c0c1e17a2593898dbefe`. Product choices are comparisons, not native guarantees. |

Current dependency ownership is recorded in the [root manifest](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/package.json), [Pi manifest](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/package.json), [Durable manifest](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi-durable/package.json), and [workspace patch configuration](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/pnpm-workspace.yaml). The Pi AI ultra and Google fetch patch targets 1.3.0. Version inspection establishes the target, not provider or desktop acceptance.

### Compare identities before unifying names

An execution here means work involving model and tool cooperation, not one model request. A child task is initially a delegation relationship; not every harness has a distinct Task entity.

| Sample | Session / execution context | Input identity | Execution boundary and identity | Subagent / delegation |
| --- | --- | --- | --- | --- |
| Pi | `sessionId`; SessionManager retains an entry tree and active leaf | SDK input does not uniformly return a persistent Submission ID; RPC `id` correlates a command response; retained history has entry IDs | `turn_*` covers smaller model/tool cycles; work can follow `agent_end`; `agent_settled` is an outer settling boundary, but input during notification can schedule more work. No common persistent run ID accompanies subscription events. | The official example starts a Pi subprocess; its convention is not the core SDK's universal child protocol. |
| DSH | `ThreadId`; Session is an event log with `seq` | Identified message / `MessageId`; inbox, claim, and history insertion are distinct | A `turn` contains several `step`s; session + turn locate execution, step locates an inner cycle | Local children have stable ThreadIds and later activations; external executions need not accept further messages. |
| Pi Durable | `ConversationId` within storage | `SubmissionId`; optional conversation-scoped `requestId` deduplication | A run includes multiple turns; experimental events describe it with `inputs: SubmissionId[]`, without a separate runId; persistent Task is another dimension | A Task may own a child conversation; generation and tools also use Tasks, so Task does not mean subagent. |
| Codex | `Thread.id`; this baseline can share `sessionId` across a parent/child thread tree | `clientUserMessageId`, queue `QueuedSubmission.id`, and the eventual user item have different purposes | Native `Turn.id`; start returns a Turn, steer can specify `expectedTurnId` | A child is a Thread; `parentThreadId` gives the relationship; a collab tool item has its own ID and receiver thread IDs. |
| ACP v1 | `sessionId` | JSON-RPC request ID correlates the prompt request | The prompt response gives completion via `stopReason`, not a separate persistent execution ID | The core prompt/tool-call protocol does not establish a universal child relationship. |
| ACP v2 baseline | `sessionId` | Prompt response returns the inserted user `messageId` | `state_update` reports foreground state without promising an addressable execution entity | Child sessions are described by the experimental subagent protocol, not guaranteed by the v2 baseline. |

The sample sections below contain sources and limits. Identity scope is part of the contract: an equal string may be unique only within one session or one entity kind.

### Pi coding-agent

#### Native behavior

`AgentSession` owns the current conversation, model, tools, queues, and extensions. SessionManager's entry tree supplies model context. Changing the active leaf or applying compaction is different from displaying all historical content. [SDK](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/docs/sdk.md), [session format](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/docs/session-format.md)

`prompt()` can be handled by an extension command without starting a model. `steer()` joins work after the current assistant turn and its tools; `followUp()` joins after pending work in the current run. `queued` does not prove model consumption. An RPC command response does not mean execution completed successfully. [RPC](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/docs/rpc.md)

`message_end` supplies a completed message. `agent_end` is an inner loop boundary; recovery or queued work may continue. `agent_settled` is an outer notification, but a new prompt submitted during that notification may be deferred, so it does not establish permanent idleness. None supplies a common persistent run ID. A settled event cannot simultaneously prove one input completed, one model request completed, and the entire objective succeeded. [Session events](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/src/core/agent-session.ts), [AgentEvent](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/agent/src/types.ts)

The official subagent example spawns `--mode json -p --no-session` and sends progress to the parent tool's `onUpdate`. This composition does not by itself provide a core contract for a stable child session, conversation after restart, or independent child-stream subscription. [Official subagent example](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/examples/extensions/subagent/index.ts)

Cherry's adapter instead uses its own in-process [subagent extension](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/src/subagent.ts) with native Pi sessions. It already has message and stop controls; the common child access still rejects `submit` as `managed-child`. The current choice and proposed public control bridge belong to the [subagent control note](https://github.com/CherryHQ/cherry-studio/pull/21578). Neither the official example nor this adapter gap establishes that Pi cannot support child conversation.

#### Relationship example

Letter labels illustrate relationships; they are not native fields.

```text
Session S
  prompt A -> model turn -> tools -> model turn -> answer
                      ^ steer B
  followUp C ----------------------------------> later work
  allowed recovery, extension continuation, queued work finish -> agent_settled
```

An InputId needs actual admission evidence. Pi has no common persistent ExecutionId for an adapter to manufacture. RPC request IDs are not recoverable run IDs, and the eventual session entry ID need not exist when input is admitted.

#### Admission and control evidence

| Native behavior | Consequence for the public contract |
| --- | --- |
| `prompt`'s `preflightResult` distinguishes `started / queued / handled`; its comment describes an internal RPC hook | It can supply evidence for a pinned SDK adapter, subject to compatibility tests. Prompt promise completion cannot establish admission timing. |
| Pi catches a failing extension command, emits an extension error, and still returns `handled` | `handled` identifies the handling path, not a successful outcome. Preserve the error separately; do not invent a successful execution. |
| `started` is reported after preparation and before calling the inner `agent.prompt` | It proves dispatch toward execution, not model consumption or completion. |
| `isIdle` may remain true during asynchronous commands or input handlers | An idle snapshot is neither an atomic admission condition nor proof that no submission is in flight. |
| Direct `steer()` can enqueue while idle and does not recheck its target execution after an asynchronous input handler | It does not guarantee “affect only E1.” Reading busy before calling cannot repair that race. |
| Native `abort()` waits for native idle but does not clear steer/follow-up queues; inputs still in preflight may finish handling later | Its receipt cannot claim all submitted inputs were cancelled. Preventing later work needs a host admission barrier and an explicit queue policy. |
| A prompt submitted during `agent_settled` is deferred; its call may return before the deferred action executes | Settled is neither permanent idle nor that prompt's receipt. Wait for corresponding preflight evidence or report uncertainty. |
| Native `dispose()` synchronously triggers cancellation and detachment without awaiting all execution cleanup | Its return is not completed shutdown; owned-resource shutdown needs separate coordination. |

Sources: `prompt`, `_startRun`, `_tryExecuteExtensionCommand`, `_queueUserInput`, `_emitAgentSettled`, `abort`, and `dispose` in [AgentSession](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/src/core/agent-session.ts). These are native facts; Cherry's [session owner](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/src/session.ts) additionally coordinates user stops and extension cleanup. The [runtime adapter](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/src/runtime.ts) routes managed-child interruption through that owner; it must not bypass ownership by treating a child's native `abort()` as the full control contract.

`SessionManager.open(path)` creates a new context for a missing path and can initialize an empty file. Public `open(existingRef)` cannot map directly to it. Verify the loaded native identity against the expected identity and refuse a mismatched open. An `existsSync` check alone leaves a check/load race. Strictly read-only opening also involves empty-file initialization; if required, improve native strict-open support rather than copy its session parser. [SessionManager](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/src/core/session-manager.ts)

### DSH

#### Native behavior

Session retains append-only events; `seq` is a position within that session. `turn/start` / `turn/end` enclose a model-loop execution, while `step/start` / `step/end` enclose one model call and tool execution. Plugin events may occur outside turns. Log position, execution number, and tool `callId` are different identities. [Session](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/docs/subsystems/session.md)

Agent `followup()` delivers to the next turn, `steer()` to the next step, and `inject()` adds later context without waking the driver. Inbox mutations are retained as log events with MessageId. Claiming an item removes it from the queue but does not prove model-history insertion. `cancel()` also clears pending input by default; retaining it requires an explicit option. [Agent API](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent/README.md), [agent loop](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent-loop/README.md)

SubagentManager distinguishes local continued conversations from external one-shot executions. A local child has a persistent ThreadId and at most one live activation at a time; later activation may cold-resume it. `SubagentActivation` returns childId, optional messageId, result, and dispose, not a guaranteed separate persistent activationId. Dispose targets that activation and must not stop a later resumed one. External execution does not inherit local-child messaging support. [Subagent](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/docs/subsystems/subagent.md)

#### Relationship example

```text
parent Session P / turn 7 / tool call K
  -> child Session C / activation A / inbox message M
       -> turn 1 -> step 1, step 2 -> turn/end
       -> activation cleanup and result delivery
  -> later message N to C -> new activation B -> later turn
```

Child session, activation, turn, and launching tool cannot be merged into one identity. A parent's result notification must also distinguish a message from the child from the manager's report that child execution ended, or history attributes the speaker incorrectly.

With persistence mounted, DSH restores its log and inbox; without it, execution can remain in memory. Loop recovery closes turns left open by a crash. That is not exact resumption from any external tool side effect. [Persistence integration](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent-loop/README.md#persistence-integration)

### Pi Durable

#### Native behavior

Harness opens storage and schedules its work. Conversation is a transcript; Submission represents admitted input or a passive write; Task is a checkpointed execution state machine. ConversationId, SubmissionId, EntryId, and TaskId are distinct typed numeric identities and require a namespace across storage instances. [Concepts and lifecycle](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/README.md), [storage types](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/types.ts)

Input Submission `queued → placed → done / unanswered` distinguishes queuing, transcript placement, answered completion, and unanswered termination. `placed` does not prove model consumption. `requestId` deduplicates within a conversation; it can locate the original Submission after restart while the record remains retained and accessible. Passive writes also have Submissions without necessarily starting a model.

A run can contain several model turns and steer inputs. Experimental `watchEvents()` run snapshots, `run_start`, and `run_end` carry `inputs`, without a separate runId. Generation and tools have TaskIds, so an arbitrary generation TaskId cannot identify the whole run. [Event definitions](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/harness/events.ts)

Tasks may own child conversations or child tasks; generation, tools, and compaction also use Tasks. The foreground subagent example makes the tool task the child owner. The background example uses a background anchor task as owner and a reporter task to send the answer to the parent as a follow-up. Background status changes waiting and cancellation propagation, not child conversation identity. [Foreground example](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/test/examples/22-subagent-foreground.ts), [background example](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/test/examples/23-subagent-background.ts)

#### Relationship example

```text
Conversation C
  Submission A -> run { inputs: [A, B] } <- steer Submission B
                    generation Task G1 -> tool Task T -> generation Task G2
  follow-up Submission D -> next run

background anchor Task H -> child Conversation C2
reporter Task R waits for C2's Submission -> delivers result to C
```

`watch()` / `watchEvents()` connect a current snapshot to subsequent committed updates. Slow consumers may receive replacement snapshots; reconnecting is not replay from an old token cursor. A child needs its own Conversation subscription; the parent's watch does not automatically include every descendant. Durable scheduler recovery still depends on constraints such as tool replay safety. [Observation, tasks, and recovery](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/README.md#watching-a-conversation)

#### Transactions and scheduling evidence

| Native behavior | Consequence for the public contract |
| --- | --- |
| `submit` checks requestId and busy state, creates the Submission, and queues or places it in one commit | Admission and native input identity have queryable evidence; survival across processes still depends on Storage. |
| requestId deduplication is conversation-scoped; a repeated key of the same kind returns the original Submission even when content differs | Retries must preserve the original payload. Do not promise automatic content-conflict detection or acknowledge new text under a reused key. |
| `whenBusy: reject` checks `live.run`, not all unfinished work; idle `steer` may start a run | State the busy scope. Strict idle-only, active-only, and a specified execution precondition are different guarantees. |
| `submit` calls scheduler.resume before commit; Submission.wait, Conversation.waitForIdle, and Conversation.abort also resume | Waiting is not always passive; even rejected submission can wake existing work throughout the shared Harness scheduler. |
| Submission.status, Conversation queries, and watch avoid those resume paths | Prefer these for observation. The base interface omits ambiguous `waitForIdle()`. |
| Submission.abort atomically distinguishes queued, placed, and settled | Precise withdrawal can be an additional capability; withdrawing a placed input is not interruption of the entire conversation. |
| View attachment serializes the initial snapshot with observer registration; queued watch updates may be replaced by a new snapshot | Snapshot/update handoff is supported, not full event-log replay. Public events must express replacement scope. |
| watch.stop detaches and discards pending frames, but an already entered asynchronous listener may finish | Stopping observation does not imply the consumer's asynchronous persistence has flushed. |
| Harness.open reconciles leftover Task state without executing tasks; Harness.close stops and joins calls without recording task cancellation outcomes | Opening is not purely read-only. Closing is a backend-resource operation; native recovery may later continue nonterminal tasks. |

Sources: [Submissions](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/harness/submissions.ts), [Harness](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/harness/harness.ts), [Conversation view](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/harness/view.ts), [observation queue](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/session/observation.ts), [Session close](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/session/session.ts). The upstream [Submission tests](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/test/harness-submissions.test.ts) cover repeated requestId without content comparison, withdrawal stages, and cancellation while waiting; their presence is source evidence, not a claim they ran here.

### Codex App Server

#### Native behavior

Thread is the independent execution context to map. This baseline also has shared `sessionId`, child `parentThreadId`, and fork `forkedFromId`: a shared session tree, delegation, and history branching are distinct relationships. Turn has its own ID, status, items, and error. [Thread and Turn types](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs)

`turn/start` returns Turn, but this baseline can also add input to an active turn; its name alone does not prove a new execution. `turn/steer` requires matching `expectedTurnId` and returns the actual turnId. `turn/interrupt` carries both threadId and turnId. Input may carry `clientUserMessageId`, whose presence alone does not prove retry idempotency. [Turn API](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server-protocol/src/protocol/v2/turn.rs)

The queue API has separate `QueuedSubmission.id` and `clientUserMessageId`, and list, update, delete, reorder, and start operations. Queue item, user message, and execution remain distinct. Queue-service enablement, deduplication, and crash guarantees need separate verification. [Queue types](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server-protocol/src/protocol/v2/thread.rs), [queue processor](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server/src/request_processors/thread_queue_processor.rs)

Streaming item notifications locate content by threadId, turnId, and itemId. `CollabAgentToolCall` identifies a delegation tool operation; senderThreadId and receiverThreadIds identify participants. It is neither the child Thread nor all its later Turns. Knowing a child's identity does not establish that the current host subscription receives all its output; verify delivery separately. [Items and collaboration types](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server-protocol/src/protocol/v2/item.rs)

#### Relationship example

```text
Thread P / Turn T1 / collab item K -> child Thread C
                                       parentThreadId = P
                                       Turn T2 -> items / deltas
later collab operation K2 -> same Thread C -> later Turn T3
```

The public Thread should map to the native Thread, not mechanically to the field named `sessionId`. Public input, native user item, and Turn require associations; one input does not necessarily own one Turn. This is research for a possible adapter, not an implemented Codex adapter in this stack.

### ACP agents by protocol version

#### v1

`session/prompt` stays pending while the agent sends message and tool updates through `session/update`; its eventual response supplies stopReason. JSON-RPC request ID correlates the call without establishing a queryable persistent execution. Final updates may follow `session/cancel`; the prompt response confirms completion. [v1 prompt turn](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v1/prompt-turn.mdx)

```text
session S / prompt request Q
  -> session/update ... -> prompt response { stopReason }
```

#### v2 baseline, still draft as a whole

A successful prompt response confirms insertion of the user message and returns an agent-generated messageId. Mere receipt, queuing, or ID allocation does not satisfy that condition. Insertion does not promise persistence or model consumption; retry after a lost response may insert another message. [v2 prompt lifecycle](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v2/prompt-lifecycle.mdx)

Foreground execution is described independently of the prompt request through `state_update` running, requires_action, and idle. Background activity can continue while idle and trigger new foreground work. This state is not an independently identified Run, and a reconnect snapshot is not a new execution start or end.

Content IDs are scoped by session and entity kind: equal messageIds may identify an agent message and an agent thought separately. Projection cannot merge them by their string alone. Restoration replays retained history, without guaranteeing retention of every inserted message. [v2 identity rules](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v2/prompt-lifecycle.mdx#entity-ids), [v2 session setup](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v2/session-setup.mdx)

```text
session S / prompt request Q -> insert user message M -> response { messageId: M }
foreground state and output update separately: running / requires_action -> idle
background child or task may continue; later foreground work may start
```

The diagram states semantic relationships, not a required arrival order for running state, message updates, and prompt responses.

#### Experimental subagent representation

The Subagent RFD announces a child session through `subagent_update` on the parent session; child output is delivered automatically on the same connection under the child's sessionId. A child can receive repeated delegations, so the relationship is not one task or tool call. Control capabilities are declared separately. This is compatible with the source identity needed for lanes, but not a guarantee every ACP implementation provides. [Subagent Sessions RFD](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/rfds/subagents.mdx)

### Cherry and OAR integration comparison

Host coordination remains necessary. The structural issue is that execution and presentation share too many identities and lifetimes, not merely a large service or two histories.

| Existing desktop seam | Source structure | Design constraint |
| --- | --- | --- |
| Native sessions hidden behind connections | Public operations revolve around connect, send, redirect, and close; the Pi connection calls SessionManager.open/create internally | Separate native context identity, access handle, transport connection, and running resources; an opaque token alone must not define recovery semantics. |
| Presentation turns mixed with native execution | startContinuationTurn creates a new assistant row and turnId after steer without sending a new request to the harness | Presentation segmentation may change; execution identity changes only with a real execution boundary. |
| Input scheduling spans owners | The host queue decides when to send; redirect receipts and events decide later turns; the harness also schedules input | Confirm receipt, delivery, queuing, and context placement separately; one owner makes each scheduling decision. |
| Child output depends on parent messages | Background flow uses rootToolCallId to find a parent-message anchor and choose the current stream or background accumulator; output without an anchor is ignored | Organize child content by its own source; retain parent tools and messages as relationships. |

Sources: [desktop connection and events](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/runtime/types.ts), [Pi creation and restoration](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/runtime/pi/PiRuntimeConnection.ts), [host turns and background output](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/agentSession/AgentSessionRuntimeService.ts). These are static structural findings, not reproductions of every possible race. The [desktop Pi README](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/runtime/pi/README.md) confirms that the new package is not yet used by the existing connection.

Opaque resume tokens, host input queues, and presentation history can all exist. Their existence is not the defect; unclear evidence, ownership, and competition with native state are. Product-session message delivery likewise does not establish subagent ownership; the [subagent control note](https://github.com/CherryHQ/cherry-studio/pull/21578) records that distinction.

At OAR baseline `141921ea5a818bd8b0a1c0c1e17a2593898dbefe`, `packages/oar/src/runtimes/pi-durable/session.ts` resumes on open and folds some Submission outcomes into turn_ended. Cherry's current adapter separates access from explicit resume and does not impose a universal Turn. OAR's steer-state precheck alone cannot prove admission still targets the same execution. This is guarantee-boundary analysis, not a reproduced user failure.

### Verification records and remaining acceptance

#### Historical execution: Pi 1.2.0 offline probe

The original research records `node .context/harness-research/pi-probe.mjs` exiting 0. The script and JSON remain workspace research attachments under `.context/harness-research/`, not distributed regression tests. The retained JSON explicitly identifies `packageVersion: "1.2.0"`. Reading it during this migration is not a new execution.

| Pi 1.2.0 probe | Recorded result |
| --- | --- |
| Can a failing local command look successful? | Prompt resolves, preflight reports handled, an extension error appears, and there are no messages; handling path and outcome must be separate. |
| Does idle steer start execution, and does abort retract it? | Idle stays true and the queue retains the same text after abort. |
| Are idle / abort an admission barrier while an input hook waits? | Idle is true; abort returns first; handled arrives only after releasing the hook. |
| Does opening a missing path strictly fail? | It returns an empty context with a new sessionId; native open cannot directly implement public open. |

These probes covered no model stream, extension subagent, network failure, crash, or real tool side effect. They cannot establish full adapter compatibility.

#### Existing adapter tests and historical validation scope

The predecessor document records passing initial adapter validation with native Pi, offline AI SDK models, and Durable's faux provider, MemoryStorage, and Node SQLite. It records no complete command transcript or exact-head mapping for that whole validation, so it is historical evidence rather than a fresh pass of the migration head. The current files below preserve executable regression coverage; no runtime tests were rerun for this documentation-only migration.

| Current regression source | Behavior covered by its tests |
| --- | --- |
| [Common observation](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime/tests/observation.test.ts) | Slow-consumer isolation; bounded overflow followed by gap and snapshot; snapshot first; stopping without waiting for an entered consumer; exception and mutation isolation; replacement order; asynchronous dispatch and reentrant order. |
| [Pi adapter](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/tests/runtime.test.ts) | Shared content identities across accesses; streaming and release isolation; native busy rejection; command preflight and queued follow-up; rejection of a wrong native identity; orderly native file close and reopen. |
| [Pi native session](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/tests/nativeSession.test.ts) | Native provider execution and caller ownership of the borrowed model runtime, independent of Cherry's AI SDK bridge. |
| [Pi Durable adapter](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi-durable/tests/runtime.test.ts) | Current views and input completion; busy rejection, deduplication, conversation-scoped withdrawal; admission receipts surviving later status-read failure; independent owned-child observation; orderly SQLite close/reopen; passive observation/query followed by explicit resume. |
| Cherry bridge tests under `src/main/ai/runtime/pi/gateway*.test.ts` | Model bridge, native history, tools, compaction, goals, foreground/background subagents, continuation, and result delivery. The [subagent stop tests](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/runtime/pi/aiSdkSubagentStop.test.ts) also exercise child-thread interruption through the owning controller. Native-only tests stay in `packages/agent-runtime-pi/tests/`. |
| [Validation selection](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/scripts/__tests__/validationPlan.test.ts), [validation workflow](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/scripts/__tests__/validationWorkflow.test.ts) | Packages enter affected selection; changes to the common package include both adapters' consumer checks. |

Client tool validation belongs to the executing harness. The gateway preserves object arguments and call identity even when schema validation fails, so the harness can return an error and the model can correct it. Rejecting every validation error breaks that loop; replacing null or unparseable arguments with `{}` can execute a different call. The gateway rejects non-object error inputs instead. `toolInputRecovery.test.ts` exercises both outcomes through the wire converters and a native Pi loop; its shared fixture lives in `tests/helpers/piGateway.ts`, outside production runtime code.

The [Pi bridge README](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/runtime/pi/README.md) specifies real AI SDK streaming against a local HTTP provider. This is not live-provider acceptance, the complete upstream SDK test suite, or Electron acceptance. Test files and historical passes must not be used as substitutes for those boundaries.

#### Remaining gaps

- **Product integration:** AgentSessionRuntimeService, lanes, presentation projection storage, IPC, and multi-window consumers have not migrated to the new adapters. UI behavior after a parent message finishes still needs application acceptance.
- **Identity and coverage:** Pi content identity belongs to the current source; rebind and compaction reset it. Durable history uses native entry IDs; live-preview to retained-entry association does not promise seamless `replaces`, and uses gap plus replacement snapshot. Presentation archives are not native contexts to import back.
- **Recovery:** SQLite coverage is orderly close/reopen, not process crash, external tool effects, or realistic simultaneous recovery of multiple Conversations. Exactly-once tool execution is not promised.
- **Control scope:** Pi's extension owns child inputs and result delivery; common managed-child submit remains unsupported. Child interrupt uses the owner's controls, not a general delegation cancel API. Durable uses ordinary native abort scope; background subtrees, queued writes, task orphaning, and recovery failures still need focused acceptance. Its child test establishes discovery and independent observation, not a complete continued-child-conversation flow.
- **Protocol scope:** The common text/reasoning protocol omits images. Pi intermediate tool execution output and Durable nested-tool progress are not projected; Durable does project retained live tool output. History pagination, exact Execution control, Interaction, and unified spawn/cancel are outside implemented v0.
- **Input boundaries:** Full SDK-upgrade probes, storage-failure matrices, and durable host delivery records after callers stop waiting remain gaps. The Pi bridge has settle-time coordination tests, but they do not replace focused coverage for every common-handle admission/reentry path. Do not infer missing facts from a promise or idle snapshot.

Unsupported or unknown can be legitimate results, but neither passes acceptance for a stronger guarantee. Package READMEs and the runtime contract retain these limits; test totals are not a substitute for explaining them.

## Alternatives considered

- Unify by names such as session, turn, and task: rejected because the samples give those names different identity scopes, boundaries, and persistence guarantees.
- Treat source inspection or historical passes as current compatibility: rejected because version, adapter path, storage, and environment determine which claim was actually tested.
- Add a common queue or scheduler to fill every native gap: rejected because it introduces competing ownership and can conceal unsupported controls; preserve native evidence and explicit limitations.
- Require every harness to expose the richest child's conversation and cancellation behavior: rejected because one-shot tasks and observation-only children remain valid; the separate control proposal defines optional abilities.
- Declare the adapter complete once offline tests pass: rejected because production wiring, UI projection, real providers, crash behavior, and side effects require their own acceptance.

## Acceptance criteria

- AC1 — Each public guarantee is traceable to a named sample, pinned source or executed test, and an explicit evidence level; historical versions remain identifiable. (verification: docs gate — runtime contract and evidence-note maintainers)
- AC2 — Existing Pi and Durable adapter paths demonstrate input receipts, observation continuity and gaps, access release isolation, and native identity checks without a second scheduler. (verification: unit — common-runtime and adapter test owners, using explicit affected test paths)
- AC3 — Control verification distinguishes managed-child input restrictions, owner-routed Pi interruption, Durable scheduler activation, and native cancellation scope without claiming unified spawn/cancel is implemented. (verification: unit — Pi and Durable adapter owners)
- AC4 — Persistence evidence identifies orderly reopen separately from crash recovery and external effects; a stronger recovery claim includes a dedicated scenario that actually exercises it. (verification: unit — adapter storage and recovery test owners)
- AC5 — Before declaring desktop integration complete, the real application demonstrates independent child output after parent completion, the intended input/control paths, and consumer reconnection without confusing host presentation with native execution. (verification: Electron — desktop runtime and projection owners)

AC1 is a documentation constraint; AC2–AC4 require evidence on the implementation revision being accepted. AC5 remains pending because the adapters are not wired into the desktop. This proposed note does not imply the entire stack meets those criteria.

## Risks

- Pinned research can drift from later upstream releases. Retain the original claim and version, then add evidence for the new version instead of relabeling old results.
- Internal Pi preflight hooks and experimental Durable/ACP observation surfaces may change; compatibility coverage must guard the adapter's actual usage.
- A normal reopen test can hide crash, replay, and tool-side-effect hazards. Explicitly limit conclusions until those scenarios are exercised.
- Discoverable children or available input methods can be mistaken for ownership or parent-result delivery. Keep those behaviors under their native or orchestration owner.
- Current-view replacement and mapping resets can be mistaken for complete history or token replay. Consumers must honor coverage and gap semantics.
