# Pi agent runtime

`createPiRuntime` adapts native Pi sessions to the common runtime contract.
`create` creates a new access; `open` loads an existing native context with an identity check.
Concurrent handles share one execution source; release stops observation, while shutdown closes owned sessions.
`pi.observe` delivers content, input outcomes, aliases, live provenance, child task facts and settle evidence
in one captured batch. `backgroundResults` reads existing behavior records and notification inputs;
its pending and notification IDs name the current triggering tool calls, including continuations.
Results remain pending through report delivery and parent generation, including the gap before that
generation starts. Lifecycle and ledger callbacks publish them through the same ordered projection.
Its first baseline is historical; overflow recovery retains unseen terminal facts
after their body. Hosts do not parse child tool receipts or read mutable aliases at delivery time.

Each Pi handle exposes `input.submit`. Root contexts support `reject`,
`steer`, and `follow-up`. Managed children support only `steer`, through their parent's subagent
behavior rules: a live run receives a queued message; a finished child continues in the background
in the same native session. An unsupported policy is rejected before native dispatch.

Constructs native Pi coding-agent sessions. The caller supplies Pi's `ModelRuntime` and `Model`;
Pi owns the execution loop, tools, context accounting and compaction. Content deltas use the common AI SDK message reader before observer fanout; the package
imports no Cherry application code. Native tool results and progress update their calling message,
without reordering its text, reasoning and tool parts.
Behavior's child-task and continuation custom messages project as user messages with native entry
identities. Other hidden custom markers remain hidden; filtering them must not erase actual input boundaries.

## Common runtime with Cherry behavior

`PiSessionOptions` requires `behavior: { host, configureChild }`, which installs
[`agent-behavior`](../agent-behavior/README.md) through its internal Pi harness. Each root and its children
share one behavior instance. `host` implements the existing `HostPorts`: application facts and
services such as approval UI, model selection, settings, output storage and summarization.
The adapter owns native execution; behavior owns the product rules. Tests use `createScriptedHost`.

`configureChild({ thread, modelKey })` supplies only the native model and optional model runtime
once per child context. The selected model must match `modelKey` (`provider/id`). Unspecified
model bindings and extension factories inherit from the root; `onEvent` receives root events only. The adapter installs the behavior extension and
summarizer on every child, filters parent-only tools, and disables native retries and cache warming
as required by the behavior adapter's request accounting.

- Root `input.submit` preserves native commands, input hooks, busy policies and input correlation.
  `/goal` is handled locally through the behavior entry; it never becomes a model prompt.
  Local handling flushes native state before acknowledgement, including a fresh plan-held goal.
- Child `input.submit` supports `steer` through `entries.messageSubagent`, using the same admission,
  continuation and reporting rules as the model's `message_subagent` tool. Its native custom input
  carries the caller's `inputId`, including when a background report job starts the continuation.
  A refused continuation returns `rejected`; no raw child prompt bypasses that decision.
- `interrupt()` records a user stop through the root or child entry. A foreground child's stop
  stops its parent turn; a finished child does not stop later work. A continued child's run is
  background work and has no cancellation ownership from its completed foreground run.
- `pi.permissionModeChanged()` notifies behavior after the host changes permission settings;
  `pi.compact(instructions)` uses its summary acceptance and compaction lifecycle. A declined
  summary returns `rejected` with code `declined`; no native summary fallback runs.
  Interrupt and shutdown cancel native compaction even when no behavior run is active.
- Subagent relations are projected onto the parent; each live child can be opened, observed and
  released independently. Releasing a handle stops its observations. Shutdown closes the shared
  behavior instance, all native sessions and projections.

`pi.settled()` waits for admitted native work, including the shared root,
children and reporting jobs. It does not interrupt or close the owner, seal new admission, or flush
host archives. A host using it for a write barrier must first block new input and join its admitted
submissions, then await observation delivery/callbacks and drain archive writers after native work settles.
Shutdown must close native production before joining observation delivery; waiting for a running Pi turn
to settle before requesting its shutdown can deadlock.

Host extensions must not install duplicate behavior tools or start native runs themselves.
The desktop connection supplies its host through `src/main/ai/runtime/pi/piBehaviorHost.ts`; its production
approval, question, model, summary, verifier and output ports use existing Cherry services.

Reopening a root restores its child graph from saved run/origin entries and identity-checked files,
without resuming work. Missing or ambiguous child files are not replaced. A loader cannot reopen a
stored child as an independent root: that returns `child-owner-unavailable`. Restored child input
still passes the parent's continuation policy, including its persisted stopped-turn state.
If a historical child's native session cannot initialize, its temporary registration is removed
and the error is reported without preventing the parent or healthy siblings from opening. The saved
relationship and completed results remain intact; recovery never substitutes another model or
records the initialization failure as a new task result. A later owner reopen can retry that child.

`tests/behaviorRuntime.test.ts` exercises these public accesses against real Pi execution with
scripted native providers and host ports, rather than calling the harness ports directly.

## Native session configuration

`createPiRuntime` owns its internal session builder; that builder and the behavior harness are not
package exports. The caller supplies Pi's `ModelRuntime` and `Model`. The model runtime is borrowed:
closing a session does not unregister its providers. The runtime disables native retry and cache
warming for behavior request accounting; thinking level retains native Pi semantics.

The builder uses in-memory settings, disables resource discovery, and accepts
explicit tools, extension factories, system prompts, workspace context files and skill directories.
Without a `systemPrompt` Pi's own prompt is used, and Pi appends a `<cwd>` section either way. No
built-in tool is enabled unless `builtinTools` names it. Workspace `AGENTS.md` / `CLAUDE.md` files
load only with `contextFiles: true` (explicit project trust), and skills only from the host's
`skillPaths`. `excludeTools` removes disabled tools from the native loadout.
`dispose()` aborts execution, lets extensions handle `session_shutdown`, then disposes the session.
Pi is ESM-only; CommonJS hosts must load the package with dynamic `import()`.

Known gap: Pi's resource loader still resolves its discovery directories while it loads; the
`no*` flags and prompt overrides discard everything it finds there.

## Cherry integration

Cherry registers native Pi providers against its internal gateway in `src/main/ai/runtime/pi/gatewayModelBinding.ts`.
The gateway owns upstream credentials and billing. Pi owns protocol replay and tool execution; behavior owns continuation and retry policy.

Cherry's desktop root Pi connection uses this package through `create/open/observe/input.submit`.
Live child projections feed independent desktop message archives and IPC subscriptions. Native session, goal and subagent
tests live in `tests/`, using Pi providers directly. `tests/sessionSupport.ts` supplies native
scripted streams with fixed usage for budget and compaction assertions, without an HTTP or AI SDK fixture.
Cherry gateway integration tests remain in `src/main/ai/runtime/pi/`.
The typed `pi.archive()` facet supplies committed content and proven native-entry/live-message aliases and legacy part mappings;
it excludes a child's inherited parent context. It remains readable after native shutdown until the
access is released, so the host can finish archiving the quiesced tail. This is not a mandatory common
Runtime history interface.
`tests/nativeSession.test.ts` verifies native provider execution and borrowed-runtime ownership.
`tests/runtime.test.ts` exercises public child discovery, input and observation through native
execution, including continuation, release, once-only native reporting, and shutdown during child loading.

```bash
pnpm test:agent-runtime-pi packages/agent-runtime-pi/tests/nativeSession.test.ts
pnpm test:agent-runtime-pi packages/agent-runtime-pi/tests/runtime.test.ts
pnpm --filter @cherrystudio/agent-runtime-pi typecheck
```

## Native session storage

Pass `sessionManager: SessionManager.create(cwd, sessionDir)` to create a persistent session, or
`SessionManager.openExisting(file, expectedId, cwd)` to reopen a known association strictly. Omit the manager for an in-memory session. The host chooses
the location and records the native session ID/file association. Pi writes and reads its own JSONL;
there is no second transcript schema, message conversion for storage, or host event replay.

A native file includes messages, provider signatures, usage and cost, compaction boundaries,
context edits, branch entries, system state and extension entries. Extensions see restored state
at `session_start`. Activated tools are recorded as a native `cherry.tool-loadout` entry and restored
beside the host's current base tools. Reopening context does not resume work automatically.

Pi creates the file lazily, once a user or assistant message exists. The pinned `SessionManager.flush()`
also persists local-command state without adding a model-visible message; in-memory sessions stay in memory.
Pi's low-level `open` also
accepts a missing path as a new session; hosts loading an existing association must check its
existence and verify the native session ID instead of silently replacing it.

`onEvent` observes copied native entries (`session-append`), compaction start/end, and completed
turns. These events are for observation; storage works without a listener. A slow listener should
hand off its work because callbacks run inline. `dispose()` flushes the final observations.

## Context usage

Common `contextUsage()` reads native `getContextUsage()` and the selected native projection.
Counts and partial categories use Pi's estimator; deferred tools are listed separately. After
compaction, Pi may leave occupancy unknown until its next request establishes a new baseline.
Section and tool provenance is recorded with the prepared native prompt. Memory files and skill
catalog entries carry individual estimates; reading skill bodies later contributes to messages.
Explicit tool origins separate MCP schemas from system tools without name heuristics. Old opaque
sections remain system prompt estimates. Reading does not reload files, submit input, change the
selected branch, or write history.

## Pi-specific access

The handle's `pi` facet provides native branch history, tool metadata and opaque
item-to-tool-call lookup. These remain Pi-specific, without enlarging the common contract.
`compact(instructions?)` serializes with input admission and rejects an actively streaming root;
it does not abort that turn to compact. `cancelQueuedInputs()` is owner-only and idle-only: it clears
native queued input, records `aborted` for known unplaced inputs, and returns their identities.
`permissionModeChanged()` applies the current host permission mode to the shared behavior.
Released access cannot use these controls. Neither operation deletes the native history.

## Input correlation

The pinned [Pi 1.5.2 patch](../../patches/@earendil-works__pi-coding-agent@1.5.2.patch)
adds an optional caller `inputId` to native prompts, steering, follow-ups, and custom messages.
Pi carries it with the actual message through input transforms and queues. After its session
manager appends that message, `input_placed` reports the token and native entry ID; the builder's
`onEvent` forwards this as `input-placed`, after the corresponding `session-append` observation.
Placement does not promise a file flush, model consumption, or successful completion.

The common handle forwards `InputDraft.inputId` for roots and owner-managed children. Its
projection publishes the `placed` fact and associates visible input messages with that ID.
Hidden child custom messages remain hidden. Local handling emits `locally-handled`; an explicit
native command failure also records `failed`, and a later admission receipt preserves it.

The token is neither a deduplication key nor persisted in the native transcript. A host needing
restart correlation must save the observed input/entry association. The native patch snapshots
unanswered placed inputs at request preparation. Normal replies keep their batches provisional
until native retries, recovery, and `agent_before_settle` have finished. A continuation resumes
the latest reply's batch; an independent queued follow-up keeps the preceding answer association.
Only final native settlement publishes outcomes, so continuation failure cannot leave a provisional
answer marked completed. Queued or subsequently placed inputs are excluded from the preceding response.

`input_settled` reports the native input batch and final answer. The projection uses that answer
to determine outcomes: completed, failed, aborted, or unanswered (including truncated output).
It does not expose a second input-to-response association. Native input references remain available
for host persistence; billing retains its native response identity independently. The synchronous
`onEvent` surface forwards `input-placed`, not a duplicate settlement event.

## Compaction and shared tools

`compaction: { reserveTokens, keepRecentTokens, enabled? }` controls native thresholds. The behavior
lifecycle supplies the summarizer through the host's summary port. A failed or empty summary cancels
compaction without a native-model fallback. `pi.compact()` remains available when automatic compaction
is disabled. The internal native builder also tests Pi's default summarizer; it is not a host API.

[`agent-behavior`](../agent-behavior/README.md) owns AskUserQuestion, Todo, goals, output offload,
recall and subagent policy. There are no separate Pi extensions to install for these features.
The host supplies approval/question UI, output storage, model selection and summarization through
`HostPorts`. Contract tests use the same adapter with `createScriptedHost`; there is no separate
Node product entry point.

Child creation records native lineage before configuration finishes. `pi.openChild(toolCallId)`
waits for that admitted creation; it never creates another task. Each child uses the shared behavior
instance, native session and history. Its input, stop and continuation obey that owner's policy.
Root release does not stop a child; runtime shutdown joins the entire owned graph and observation
callbacks before the host's final archive flush. Usage reported by child tools is budget evidence;
the gateway already bills those requests.

## Behavior ports

The internal `createPiBehavior({ install, openSession, onError? })` implements the harness ports of
[`@cherrystudio/agent-behavior`](../agent-behavior/README.md) (`HarnessPorts`, H1 to H12) on native coding-agent
sessions and passes the package's contract (`tests/behaviorContract.test.ts`). It holds no rules: what to write, start
or stop comes from the handlers `install` registers and the steps they decide. The runtime uses this harness for every root and child.

- `install(ports)` runs once, before any conversation opens. `onError` receives what no caller awaits: a job that
  threw, a run that failed to start, the `onCompacting` or `onCompacted` of an automatic compaction, what a handler Pi
  calls threw (`omit`, `before`, `after`, `onClose`), a `cherry.rollback` entry that failed to write, a run the adapter
  did not start, and a compaction cancelled because it bypassed `summarize`.
- `openConversation(sessionManager)` opens a conversation and runs `onOpen` before it resolves; `reopened` is whether
  the manager already held entries (a stored session), so open a new conversation on an empty manager.
- `openSession({ sessionManager, extension, summarize, child? })` is supplied by the runtime for every session the adapter
  opens: build the session with `createAgentRuntimeSession` on `sessionManager`, install `extension`, pass `summarize`
  as `compaction.summarize` (every compaction, manual or automatic, then asks `onCompacting`, and a decline's reason
  becomes the `compaction-end` error; never the host's own summarizer, which the package calls through `onCompacting`;
  the builder exposes the configured callback as `compactionSummarizer` for identity validation, independent of extension ordering; a session built without it, or with another summarizer, fails closed: each compaction is cancelled, `compact()`
  rejects and `onError` hears why, since Pi would otherwise compact without asking `onCompacting`),
  keep Pi's retry off, and for a child (`child: { parent, origin }`) give it the model `child.origin.modelKey` names and
  keep Pi's cache warming off (`cacheWarming: 'off'`): warming requests bypass `agent.streamFunction`, so the request
  meter would not count them.
  The adapter registers the package's tools itself, in a child minus the `'parent-only'` ones; host-owned tools follow
  the host's own child configuration.
- `withCall(thread, use, { inputId?, signal? }?)` binds the outbound ports to one host call; they expire when `use`
  settles. The optional input ID follows that thread's custom message, including one sent by a job created in the
  call; the signal withdraws its waiting steer. `submitUser` (a person's text), `prompt`, `compact`, `settled` and
  `close` are its other entries; `submitUser` is used only by the port contract harness. `prompt` preserves native command/input preflight and native steer/follow-up
  queues inside the current execution; `submitUser` uses the adapter's inbox for separate runs. The inbox waits for
  host prompts, including native preflight. Once they finish, eligible queued work resumes; execution failure or
  interruption still leaves it queued. `close()` first waits for opens in progress (a session being built, `onOpen`)
  and then tears them down with the rest. Before disposing any session it stops every run as `turns.stop` does,
  withdraws queued input, and joins host prompts even when their preflight outlived the preceding run. A prompt
  admitted during closure is stopped at native run start before any model request. An uncancellable preflight can
  delay closure until it returns. Once it began, no job starts, an open leaves the input queued during it unstarted, and a session built
  after that is disposed unopened, its open rejecting with the closed error. New prompts, compactions, turn starts, child messages and child creation reject as soon as closing begins; reads and stops remain available for cleanup.
- Only the adapter starts runs in a session it opens. Use `submitUser`, `prompt` and `compact`, never `session.prompt` or
  `session.compact`, and install no extension there that starts a run (`pi.sendMessage(…, { triggerTurn: true })`,
  `pi.sendUserMessage`), also not while a run settles: the run state below (the request meter's count, the gate's call
  window, the live facts) belongs to runs the adapter starts. A run that begins while the adapter has none is reported
  to `onError`; one that begins while an adapter run is about to start is taken for that run, unnoticed.
- `compact(thread)` first aborts a run in progress (Pi's `compact()` begins with `abort()` and waits for the run to
  settle), but not the foreground children that run owns: stop the run with `turns.stop` first when it may be waiting
  on one. It resolves once `onCompacted` has run, or, compacting nothing, once `onCompacting` declined.

| Port | On coding-agent |
| --- | --- |
| H1 `Ledger` | `read` projects the whole branch with `decodeEntry` (compactions kept, other Pi entries left out): records are `custom` entries, markers `custom_message` entries whose `details` hold the data; a user entry carries its text, and every tool call and result its `callKey`. `keysSeen` holds the keys of the branch's records and markers and of the thread's live jobs; a child's `lastItem` is its last projected entry. `transact` reads, calls `decide` and writes with no await in between; a quiet input is a `custom_message` entry the commit writes as it writes a record, refused unless the conversation is idle, and once the commit stands the session refreshes its context (`refreshContext`, as Pi does after its own append) without the `message_start` and `message_end` Pi's `sendCustomMessage` emits: nothing in this package reads them for a marker, which `display: false` keeps out of the transcript, and `onEvent` gets its `session-append` with the session's next event, as for a record; a spawn creates the child's storage once every operation is checked and before any write, writes both records in the commit and builds the child session right after; a commit makes every disk write, quiet inputs included, before it registers a child or a job, and one that rejects leaves no record or marker on any branch, no child, no job and no session file: a failed write puts back each branch it moved and appends a `cherry.rollback` entry there, left out of the facts, so a reload lands on that branch too, and where storage refuses that entry as well, the branch stays put back so a later write follows what is on disk; a fork copies its source's branch up to the fork point, and a fork of the transacting conversation (a fork subagent) answers each call of the fork point with `FORK_PLACEHOLDER_RESULT`, while an explicit fork of another conversation leaves them to the interrupted result (H3); a commit waits for every child build to settle before starting its jobs, each from the next microtask; healthy siblings can run even if another build failed, and the transaction caller still receives the build failure. `modelContext` is Pi's context after compaction, without the markers the context filter omits. |
| H2 `Turns` | Admission is the adapter's: one run per run-starting input, from the input to Pi's `agent_settled`. A known key returns its first answer; a key only the branch still holds answers `'started'`. A `start` while a run is active is `'busy'`; once `agent_settled` has ended the run, a `start` begins a new run and never continues the settled one. Queued input waits in the adapter, not in Pi's follow-up queue, and starts when a run completes; after a failed or aborted run it stays queued until the next submission or compaction. `stop` withdraws queued input and aborts the session and the foreground children the run owns; a stop made while Pi still prepares the run is repeated at `agent_start`, because Pi drops it. A stop with `turn` acts only when it names the latest turn input in this process's latest run (the starting custom message or latest native user input, including steering) and otherwise resolves at once, so a repeated stop never reaches a later run, not even one whose input Pi has not written yet. |
| H3 `Helpers` | Continuation keeps the same native session and id. A reserved number is a minimum for a new run, with zero usage for skipped numbers; it never conditions admission to an active run. Foreground cancellation ownership ends with the child's first run, so stopping that parent turn cannot stop a later background continuation. The input that would start that first run, sent through the owning tool call's ports after its signal aborted, starts nothing and answers `'withdrawn'`: the stop may have passed the child while it had no run. A message to an idle child first answers each call of the child's last reply that has no result with `INTERRUPTED_CALL_RESULT` (an error result; not when that reply failed or was aborted), then starts a run with it. One to a running child is a steer: the adapter keeps it and hands it to Pi at the run's next turn end, right before Pi polls its steering queue, one steer per turn, and `message` answers `'queued'` once Pi placed it. If normal completion comes before consumption, the message starts a subsequent run and `message` returns `'started'` with its actual run number. The request key is unchanged; replay never resubmits it. Stop, failure, or the sending tool call's abort withdraws unconsumed input. `awaitAnswer` follows the input's actual run. `stop(child, run)` acts only while `run` is the child's active run; a child of an earlier process has none (D5). |
| H4 `Jobs` | An in-process promise per job, deduplicated by key: a live job keeps its key, an ended one frees it. A job ensured in `onOpen` starts once `onOpen` has run. |
| H5 `Waits` | Both follow the adapter's runs, which end at `agent_settled`. `untilIdle` resolves once no run is active and no host call is in flight (`hostCallInFlight`: a person's prompt not yet started as a run, a host `compact()` not yet returned, or a compaction in progress); inputs a failed run left do not hold it. `untilDone(thread, key)` resolves once the run that took the input submitted under `key` has ended, after the inputs queued before it, and at once for a withdrawn input or a key nothing was submitted under in this process (a `'busy'` start records nothing). |
| H6 `Memory` | One map per harness, shared by every conversation. |
| H7 `Clock` | `Date.now()`, never decreasing. |
| H8 `Tools` | `pi.registerTool`, `model-only`, in every session the adapter opens; a child session gets only the tools whose `availability` is `'all'`. |
| H9 `ToolGate` | `tool_call` and `tool_result`. `before` gets the call with the run's abort signal (the handler context's `signal`), which aborts when the call's turn stops; `after` gets the call `before` saw, `nested` included, with the arguments the call ran with. The call key is `<sessionId>:<toolCallId>`. `GateFacts.plan` is the latest `plan` record on the branch; `goalRound` and `callWindow` come from the run's starting input and its calls so far (nested calls left out), kept in memory per run. A blocked call's result reads `Tool call blocked: <reason>`, as on Durable, and projects back as an error result with that text. |
| H10 `ContextFilter` | The `context` event, before every model request; see the note on omitted markers. |
| H11 `RequestMeter` | Wraps `agent.streamFunction` and counts the requests of the adapter's run, with lineage `'child'` for a spawned session and `'root'` otherwise; a refused request fails the run with the refusal text, and the run's answer is `limit_reached`. A compaction during a run (Pi's automatic one) is one of its requests: the adapter's summarizer asks the meter first and counts it, and a refusal cancels the compaction, with the refusal text as its `compaction-end` error, without asking `onCompacting`. |
| H12 `Lifecycle` | `onOpen` once the session is built (after Pi's `session_start`), for the conversations the host opens and not for spawned children. `onCompacting` before every compaction, through the summarizer the session got as `compaction.summarize` (Pi's `session_before_compact`), under the key `<sessionId>:<id of the entry the compaction follows>`: the request captures the full branch before awaiting the summary, and any returned accounting record is appended once by its key and included in the active child's run usage; a summary becomes the compaction's, and a decline cancels it, its reason becoming the `compaction-end` error. `onCompacted` once Pi has finished a compaction that produced a summary (`compaction_end`), also in the middle of a run; `onClose` at `session_shutdown`. |

### Declared differences

| # | Difference | Why |
| --- | --- | --- |
| D1 | Runs, jobs, waits and memo do not survive a restart; the contract's five `restart` cases are skipped. | coding-agent resumes nothing after the process ends (H4, H6, H12 `@harness coding-agent`; see "Native session storage"). |
| D2 | `onOpen(reopened: true)` finds no run to stop: `turns.stop` there, and `helpers.stop` of a child of an earlier process (D5), do nothing and resolve at once; `live.runEnd` stays absent until a run ends in this process. | D1; H12 `@harness coding-agent`: no stop before resume. |
| D3 | A child session that fails to build after its commit leaves both spawn records and is not in `children`. The adapter calls `onChildOpenFailed` before starting the commit's jobs, then `transact` rejects with the build error. Shared behavior records the first run as failed and releases its capacity. | H1 `@harness coding-agent`: the session is built right after the commit; the adapter reports the failure and behavior owns terminalization. |
| D5 | Reopened child runs are inactive; their saved native session and lineage can be restored, and continuation goes through the parent owner. | Reopen restores history without resuming prior runs. |
| D6 | Temporary: `ChildFacts.runUsage` includes replies and reported summary accounting, but not usage Pi puts on tool results (calls made through `ctx.executeTool`). | The adapter adds up each reply's usage at `message_end`; PR-2b completes it with the usage reporting. |

Implementation notes (not differences):

- Runs end at `agent_settled`, and the run that settled is never continued: a person's text that arrives while the run
  settles starts the next run, as does a steer that missed the final boundary, and a `turns.start` is `'busy'` until
  `agent_settled` has ended the run (H2, H5 `@harness coding-agent`).
- Pi can only clear its whole steering queue, so the adapter keeps steers itself and hands Pi one at each turn end,
  right before Pi polls the queue. A steer Pi was handed is being placed: a stop, a `retract` (`'already-started'`) or
  its call's abort no longer withdraws it. At normal completion, unplaced steers start subsequent runs; stop or failure withdraws them. Steers join a
  run one per turn, as Pi's default `steeringMode: 'one-at-a-time'` does.
- A person's text that arrives while the conversation is busy waits in the adapter's inbox, one run per input, never in
  Pi's follow-up queue (`ContractHarness.sendUser`).
- `ContextFilter.omit` returns entry ids, but Pi's request messages carry none, so the adapter maps each id to its
  marker's kind and `key` and drops that marker; a marker without a key cannot be left out.
- A child session gets only tools whose `availability` is `'all'`; nothing is filtered by tool name.
- `GateCall.nested` is true for a call made through `ctx.executeTool` (`parentToolCallId`), for `before` and `after`
  alike.
- An automatic compaction calls `onCompacted` in the middle of a run: its handler cannot add a quiet input there (the
  conversation is not idle), and `hostCallInFlight` may still be true when it starts. A host `compact()` rejects when
  `onCompacting` or `onCompacted` throws; an automatic compaction's error goes to `onError`.
- Pi puts what `omit` (`context`), `after` (`tool_result`) and `onClose` (`session_shutdown`) throw on its extension
  error channel and carries on, and makes what `before` (`tool_call`) throws the call's error result; the adapter also
  hands each to `onError`. A failing `omit` still sends the request unfiltered, a failing `before`'s result does not
  read `Tool call blocked: …`, a failing `after` leaves the result unreplaced, and a failing `onClose` does not reject
  `close()`.
- A replacement from `after()` without `details` keeps the call's original `details`: Pi keeps them when a `tool_result`
  handler returns none (or `null`). The adapter preserves `structuredContent` and replaces each contiguous text span in place. Cherry's pinned Pi core patch also retains structured output in native tool-result history, including file reopen.
- In a stored (file-backed) conversation a fork copies its source's session file, which Pi writes only once the source
  holds a user or assistant message; a fork from a source without one rejects the transaction.

```bash
pnpm --filter @cherrystudio/agent-behavior build
pnpm test:agent-runtime-pi packages/agent-runtime-pi/tests/behaviorContract.test.ts packages/agent-runtime-pi/tests/behaviorAdapter.test.ts packages/agent-runtime-pi/tests/behaviorHistory.test.ts
```

## Known gaps

- `vcc_recall` has no regex search, `mode: 'touched'` (files worked on) or `#N:path` file
  drill-down; compaction summaries do not cite `#N` entries.
- `read` results are never offloaded, and Pi caps them at 2,000 lines or 50 KB, which can still
  overflow a small context window.
- A parallel tool batch whose results together exceed the context window, each below the
  threshold, still overflows; offloading at `turn_end` is deferred.
- Pi's `bash` tool saves the full output of a truncated command to a temp file and names it in the
  result; that file is not moved into the offload store and may be gone when read later.
- A fork's requests carry the subagent's session id, so a host that routes prompt caches by session
  id (OpenAI's `prompt_cache_key`) does not reach the parent's cache partition.
- Every fork's native session holds its own copy of the parent's history (a file-backed fork copies
  the parent's file); a host may deduplicate it.
- Goals have no fresh-context (Ralph) mode. Shared behavior reads the host permission mode before starting rounds.
- A background result reaches a busy parent only when its run settles, after the whole turn.
- Shutdown writes no snapshots for the runs it cuts off, so a reopened parent cannot tell a closed
  app from a crash.
- Messages queued for a running subagent before it is stopped are dropped with it.
