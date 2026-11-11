# Pi Durable desktop integration

`PiDurableRuntimeDriver` registers the `pi-durable` Agent type. Its driver owns one `agent-runtime-pi-durable` backend per native store. Connections borrow root accesses and own their observations and child projections.
The package implements native execution; `agent-behavior` owns product rules.

## Host services

The connection reuses Pi's gateway model binding, behavior host, approval facts,
shell configuration and tool rendering. Each native provider call reaches Cherry's
internal gateway, which owns upstream credentials and billing. Root and child bindings share
the backend model registry and are restored before native execution resumes. Each binding uses its own native provider registration, preserving other models' routes,
request options and usage callbacks even when their Cherry Provider is the same.

`durableDesktop.ts` installs native coding tools, codemode and tool search, Cherry's
prompt and selected skills. `durableMcp.ts` connects Cherry-selected MCP servers through
linked transports. Deferred MCP tools remain discoverable through native codemode;
nested calls pass the shared approval gate. Replay safety follows the server's explicit
read-only annotation; other MCP operations use native unsafe replay semantics.

Approvals, questions, model selection, summaries and large output storage use existing
host services. Host calls resolve the native ownership tree to a product root. Model options and trace, usage, approvals, questions and attendance stay root-scoped. Each root selects its own named extensions, MCP transports, skills and execution environment. Host resources remain backend-owned while retained work can still use them. Each root stores its non-secret request selection in a native conversation document. Before shared recovery starts, roots with unfinished tasks acquire their Main connection and projection consumer; sibling opening cannot silently resume them with default parameters or without a transcript writer. No additional interaction table or AI SDK model port is introduced.

## Telemetry

The backend supplies Pi's native `HarnessOptions.telemetry`. Durable owns submission and task-phase
spans, including tool identity, outcomes, committed-entry events and replay links. Cherry bridges
them to its existing developer-mode OTel provider and viewer. Native persisted carriers freeze the
initiating session and parent across recovery; roots without carriers remain untraced until a new
traced submission. Gateway SDK calls inherit the native phase parent through internal usage capture.
Pi model spans are suppressed because the SDK already records the request and usage; HTTP tracing
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
messages remain display projections. Root SDK message views pass through `ThreadMessageProjection`;
Main's `RootMessageProjection` groups them into product replies for the stream manager. Every child has an independent `ChildThreadProjection`,
archive and shared `ai.projection.*` subscription. Parent parts contain task metadata
and navigation, not the child's streamed body. Accepted child text remains the user's
text even when shared behavior wraps its native input.

Input placement reserves attribution before a model call. Each native answer is
associated with its product input once; later snapshots and autonomous child-result
turns do not repeat a prior input's response association.
The adapter delivers content, input outcomes and foreground settlement from one native revision.
The connection consumes that batch; it does not poll pending inputs or infer completion from idle.
Product snapshots and headless policy stay on the Main session entry under the input ID, including
unknown admission across connection replacement. The successor reconciles the original binding
without resending, while generation checks reject stale callbacks.

Manual compaction remains an active desktop submission until native work settles.
Its completion card requires a committed summary; an idle snapshot or a declined
summary cannot report successful compaction. Stop and shutdown retain their native
cancellation and ownership semantics.

## Stop, close and reopen

- User Stop calls `interrupt()` before closing, records the shared stop policy and
  cancels the native foreground scope. Unconsumed input is withdrawn.
- Releasing one root does not shut down its peers. Final backend release closes and joins the native scheduler without marking ordinary
  unfinished root work cancelled. It awaits observation queues and in-flight callbacks before
  flushing child archives; observation detach and access release happen last. Backup uses the
  same write barrier and holds new input until resume. Each child has one connection-owned
  access/projection record; failed attachment can retry, and failed final flush retains its writer.
- Reopening restores the same backend and conversation, rebinds child models, applies
  shared `onOpen`, then resumes the scheduler. Shared policy disarms goals and stops
  interrupted background children; shutdown is not a promise to resume every child.
- Closing a child panel only detaches its projection subscription.

Background continuation keeps one child identity. Independent continuation of an ended
foreground child is rejected because native ownership remains attached to its tool task.
Successful foreground completion carries a backend/conversation/entry checkpoint from the same committed observation batch. Fork creates an ownerless conversation in that store through the public native transaction API; retained ancestors support older checkpoints. Cold forks use a Session without enabling a scheduler, serialized against live owner creation and shutdown.

Native fork creation and its new product-context identity commit together. The operation journal records that identity before native preparation; replay reconciles it instead of duplicating the fork. Product session, messages and bindings publish atomically afterward. Failed publication leaves an identifiable inert native orphan because the SDK has no public conversation deletion API. Neither rollback nor source deletion removes shared native ancestry. Edit and resend keeps the existing sibling-message branches. Noninitial edits publish the native fork's context identity, input and checkpoint mapping atomically; first-input edits reserve a fresh empty backend/context. Recovery uses the prepared context identity because numeric native IDs may repeat across stores. File rewind and `vcc_recall` remain unavailable.

## Verification

`PiDurableRuntimeConnection.test.ts` uses the real runtime and SQLite with a scripted
provider. It covers approved argument edits, question answers, incremental output,
native identity on reopen, independent background output and continuation, late steer
attribution, repeated snapshots, and the difference between stop and shutdown.
`durableMcp.test.ts` runs an actual linked MCP server through the native tool loop.
The storage and child-projection suites cover strict reopen, interrupted binding
recovery and asynchronous archive reconciliation. These tests do not replace Electron
or live-provider acceptance, nor do they prove recovery after a process kill.
