# Pi Durable desktop integration

`PiDurableRuntimeDriver` registers the `pi-durable` Agent type. Its driver owns one `agent-runtime-pi-durable` backend per native store. Connections borrow root accesses and own their observations and child projections.
The package implements native execution; `agent-behavior` owns product rules.

## Host services

The connection reuses Pi's gateway model binding, behavior host, approval facts,
shell configuration and tool rendering. Each native provider call passes protocol request/event objects to Cherry's
gateway in process, which owns upstream credentials and billing without an internal HTTP/JSON/SSE round trip. Root and child bindings share
the backend model registry and are restored before native execution resumes. Each binding uses its own native provider registration, preserving other models' routes,
request options and usage callbacks even when their Cherry Provider is the same.

`durableDesktop.ts` installs native coding tools, codemode and tool search, Cherry's
prompt and selected skills. `durableMcp.ts` connects Cherry-selected MCP servers through
linked transports. Ordinary MCP tools start deferred; `tool_search` can find and load them
for direct model calls. Scripts can discover and call them through native codemode before
and after loading. `automation` stays offered upfront, and nested calls still pass the shared approval gate. Replay safety follows the server's explicit
read-only annotation; other MCP operations use native unsafe replay semantics.

Approvals, questions, model selection, summaries and large output storage use existing
host services. Host calls resolve the native ownership tree to a product root. Model options and trace, usage, approvals, questions and attendance stay root-scoped. Each root selects its own named extensions, MCP transports, skills and execution environment. Host resources remain backend-owned while retained work can still use them. Each root stores its non-secret request selection in a native conversation document. Before shared recovery starts, roots with unfinished tasks acquire their Main connection and projection consumer; sibling opening cannot silently resume them with default parameters or without a transcript writer. No additional interaction table or AI SDK model port is introduced.

## Telemetry

The backend supplies Pi's native `HarnessOptions.telemetry`. Durable owns submission and task-phase
spans, including tool identity, outcomes, committed-entry events and replay links. Cherry bridges
them to its existing developer-mode OTel provider and viewer. Native persisted carriers freeze the
initiating session and parent across recovery; roots without carriers remain untraced until a new
traced submission. Gateway SDK calls inherit the native phase parent through the typed in-process call context.
Pi model spans are suppressed because the SDK already records the request and usage; upstream HTTP tracing
retains wire bodies and the gateway remains the sole billing writer.

## Storage and projection

`durableContext.ts` selects and reserves the backend and branch in one database
transaction, without opening native storage. `durableNativeContext.ts` resolves
backend files through the central path registry. Its strict loader verifies native
identity without changing Cherry's binding state; explicit recovery confirms the
corresponding database binding.
`agent_runtime_backend` and `agent_session_context` bind product sessions to native
SQLite storage and conversations. Native backend and conversation markers repair an
interrupted association write without guessing by history or replacing a missing store.
Creation initializes and closes a private staging store before exclusively publishing
its final path. An initialization failure before publication leaves the same reservation
retryable. Reopening checks identity and never creates or replaces a SQLite file.

Pi Durable owns its transcript, task graph, submissions and behavior records. Product
messages retain display history. For a branch without previous native input, the Session host
supplies that branch's history as model-only reference context before its first input. The driver
initializes a passive native reference entry separately from command text, using native request-ID
deduplication across reopening. Initialization starts no model run and stays out of product
projections and behavior-authorizing user history. Both ordinary submissions and autonomous goal
rounds receive it. This creates no source-message entries or historical checkpoints; fresh bindings
capture the selected product position, and subsequent input uses native history. Root SDK message views pass through `ThreadMessageProjection`;
Main's `RootMessageProjection` groups them into product replies for the stream manager. Every child has an independent `ChildThreadProjection`,
archive and shared `ai.projection.*` subscription. Parent parts contain task metadata
and navigation, not the child's streamed body. Accepted child text remains the user's
text even when shared behavior wraps its native input.

Input placement reserves attribution before a model call. Each native answer is
associated with its product input once; later snapshots and autonomous child-result
turns do not repeat a prior input's response association.
The adapter delivers content, input outcomes and foreground settlement from one native revision.
The connection consumes that batch; it does not poll pending inputs or infer completion from idle.
It reports an input only when its state changes and reconsiders a child's status and release on
snapshots, activity changes and input changes.
An `aborted` outcome, including one caused by user Stop, settles the turn as paused; `failed` and
`unanswered` outcomes report an error carrying their native reason.
A message sent while native work runs is submitted with Durable's `follow-up` busy policy and
persisted at once. The Work composer sends it immediately instead of holding it in its follow-up
dock, because the descriptor declares `nativeFollowUp`; the connection has no single-submission gate and Main keeps no queue for it. Durable places it at the next run
boundary, in the same batch as the preceding answer. The connection announces the placement with
`steer-boundary` after that batch's projection, so the preceding answer stays in its reply and Main
opens a new one. The event marks the placement as a follow-up: Main holds it while the previous reply
is still starting, so it never joins that reply, while steers placed into the running turn still share
its continuation. Durable reports the preceding input's outcome only when the run ends, so Main
settles that reply as answered at the boundary and replaces it if the outcome is not `completed`;
cycle completion reads only the input that owns the current reply. A follow-up whose submission
fails before it reaches Durable moves to Main's queue.
`/compact` still waits in Main's queue, and input is refused while compacting.
Product snapshots and headless policy stay on the Main session entry under the input ID, including
unknown admission across connection replacement. The successor reconciles the original binding
without resending, while generation checks reject stale callbacks.

Manual compaction remains an active desktop submission until native work settles.
Its completion card requires a committed summary; an idle snapshot or a declined
summary cannot report successful compaction. Stop and shutdown retain their native
cancellation and ownership semantics.

## Stop, close and reopen

- User Stop calls `interrupt()` and keeps the access open. It records the shared stop policy,
  cancels the native foreground scope and stops running background children. Unconsumed input is
  withdrawn, including queued follow-ups, which receive an `aborted` outcome without being placed;
  Main marks each such message `paused`, shown as not sent with Resend and Edit. The connection emits
  `stop-confirmed` after the stopped turn's terminal event; the
  next message reuses the same access. An unconfirmed stop, including a native interrupt that never
  returns, closes the access after 20 seconds. If Durable completed or failed the input before the stop
  landed, Main replaces the paused reply with that outcome. When that outcome arrived before Stop
  registered, Main reads it from Durable's input record. A reply that a background run continued after
  its input ended stays paused. Deliveries receive one terminal event for the stopped reply.
- A gap is followed by a recovery snapshot. A failed child projection write is logged and
  reattaches that child from a fresh native snapshot. The backend error hook carries diagnostics
  only: it is logged and neither ends a turn nor closes a root.
- Releasing one root does not shut down its peers. Final backend release closes and joins the native scheduler without marking ordinary
  unfinished root work cancelled. It awaits observation queues and in-flight callbacks before
  flushing child archives; observation detach and access release happen last. Backup uses the
  same write barrier and holds new input until resume. Each child has one connection-owned
  access/projection record; failed attachment can retry, and failed final flush retains its writer.
- Reopening restores the same backend and conversation, rebinds child models, applies
  shared `onOpen`, then resumes the scheduler. Shared policy disarms goals and stops
  interrupted background children; shutdown is not a promise to resume every child.
- After an unclean exit, a placed input without an outcome resumes on reopen. The connection
  names it in `recoveredInputId`, and its output continues the reply Main linked to that input
  when it opened it (`reply_id`); queued inputs are saved before their replies, so row ancestry
  cannot identify that reply. A queued input that has no reply yet gets a new one. Follow-ups
  still queued are placed and answered after it. A pending reply whose input already has a
  Durable outcome is rebuilt from committed entries with that outcome; a reply already stored
  with a terminal status is not rebuilt. Boot recovery leaves admitted delivery turns pending and
  opens their Sessions so Durable finishes them; a Session that cannot connect ends its delivery
  turn as an error.
- Closing a child panel only detaches its projection subscription.

Background continuation keeps one child identity. Independent continuation of an ended
foreground child is rejected because native ownership remains attached to its tool task.
Successful foreground completion carries a backend/conversation/entry checkpoint from the same committed observation batch. Fork creates an ownerless conversation in that store through the public native transaction API; retained ancestors support older checkpoints. Cold forks use a Session without enabling a scheduler, serialized against live owner creation and shutdown.

Native fork creation and its new product-context identity commit together. The operation journal records that identity before native preparation; replay reconciles it instead of duplicating the fork. Product session, messages and bindings publish atomically afterward. Failed publication leaves an identifiable inert native orphan because the SDK has no public conversation deletion API. Neither rollback nor source deletion removes shared native ancestry. Edit and resend keeps the existing sibling-message branches. Noninitial edits publish the native fork's context identity, input and checkpoint mapping atomically; first-input edits reserve a fresh empty backend/context. Recovery uses the prepared context identity because numeric native IDs may repeat across stores. File rewind and `vcc_recall` remain unavailable.

## Verification

`PiDurableRuntimeConnection.test.ts` uses the real runtime and SQLite with a scripted
provider. It covers approved argument edits, question answers, incremental output,
native identity on reopen, independent background output and continuation, late steer
attribution, repeated snapshots, the difference between stop and shutdown, Stop without
closing, resynchronization after a child projection fault and after a root observation overflow, a
backend diagnostic that leaves the turn and its access running, naming the input that reopening
resumes, and native follow-up admission: placement after the preceding answer, a send during running
work, Stop withdrawal, a submission that throws and answering after reopen.
`AgentSessionRuntimeService.projection.test.ts` covers continuing a resumed input, outcome rebuilds,
the Stop/completion race in both orders with one terminal event, Stop on a background continuation, a
native interrupt that never returns, placed follow-ups getting their own replies in Main, including
one placed before the previous reply opens, and withdrawn input; `recoverSessionDeliveries.test.ts`
covers boot delivery recovery, including a Session that cannot connect.
`durableMcp.test.ts` runs an actual linked MCP server through the native tool loop.
The storage and child-projection suites cover strict reopen, interrupted binding
recovery and asynchronous archive reconciliation.

`tests/e2e/smoke/piDurableTurnAuthority.test.ts` runs the built Electron app against a local mock
provider: a queued follow-up, steer, Stop with subagent content and the next message, and killing
Main mid-turn. Run it with `pnpm test:e2e tests/e2e/smoke/piDurableTurnAuthority.test.ts` after the
[e2e prerequisites](../../../../../tests/e2e/README.md). Live providers stay unverified.
