# Agent behavior

Harness-neutral agent behavior for Cherry. The package holds what every agent harness must do the same way and
nothing that belongs to one harness: the vocabulary of facts, decisions, records and keys; the ports a harness and
the host implement; an in-memory fake harness with a scripted host; and the contract cases an adapter runs to prove
its harness behaves as the ports promise. The decisions behind it are in the
[Agent Note](../../.agents/notes/proposed/architecture/2026-10-18-agent-behavior-package.md); this README is the
contract documentation adapters follow.

## What this package is

```text
Cherry host -> adapters (coding-agent, Durable, fake) -> agent-behavior -> agent-runtime (types only)
```

Dependencies point one way. The package imports no adapter, Pi, Node, Electron, AI SDK, logger or host code, and from
[`@cherrystudio/agent-runtime`](../agent-runtime/README.md) only types: ids, `JsonValue` and `ContentPart`. That is
its only runtime dependency. The fake is the third harness implementation and ships here. Each layer under `src/` has
one job:

| Directory   | Holds                                                                                    | Rule                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`     | Facts, host facts, entry codecs, `Step` / `TxOp` / `Effect`, key derivation, `sha256Hex`, and the rule topics `goal/`, `subagents/`, `approval/`, `interaction/`, `context/`, `driver/` | Synchronous and pure: imports no other layer, has no `async`, `await`, `Promise` or `yield`, and touches no clock, randomness, process, `fetch` or timers. |
| `ports/`    | The harness ports (`harness.ts`) and the host ports (`host.ts`)                          | Interfaces and TSDoc only; imports core types only.                                                                                                   |
| `fake/`     | `createFakeHarness`, `createScriptedHost`                                                | The in-memory second implementation of the ports.                                                                                                     |
| `contract/` | `harnessContract` and the `ContractHarness` an adapter implements                        | The cases every harness must pass.                                                                                                                    |

The rule functions live in `core/`: each topic folder maps facts to a `Step` or a plain result, synchronously and
without I/O, and none of them is exported ([The rule core](#the-rule-core) lists them). `orchestration/` (the tools,
jobs, tool gate and host entry points that run them over the ports) is added by a later PR; until the adapters adopt
this package, goal and subagent semantics stay in the [agent-runtime-pi README](../agent-runtime-pi/README.md). Three
pure projections and one constant are exported for adapters and the host: `delegationStatus(record)` gives
`Delegation.status` for a run record, `turnOrigin(history, item)` names who started the turn an entry belongs to (a
person, a goal round or a notification), `subagentViews(facts, approvals)` lists the background children as the host
shows them, and `DEFAULT_MAX_BACKGROUND` is the default of the host's `Settings.maxBackground()`.

`"."` is the only export. Everything an adapter needs comes from `@cherrystudio/agent-behavior`; a deep import such as
`@cherrystudio/agent-behavior/core/facts` is a lint error (`barrel/closed`). An adapter depends on the package as
`workspace:*` and resolves it through its built `dist/`, so build it before the adapter's tests import it:
`pnpm --filter @cherrystudio/agent-behavior build`.

## Ports

The ports are the whole surface between the package and a harness or the host. Harness ports are `HarnessPorts` in
`src/ports/harness.ts`; host ports are `HostPorts` in `src/ports/host.ts`.

Each port's TSDoc is its specification: the intent, one `@harness` section each for `coding-agent`, `durable` and
`fake` saying how that implementation realises it, and `@keys` and `@waits` where the port has keys or waits. This
README does not repeat them; `tests/ports/portNaming.test.ts` fails a port that lacks them. Methods and parameters
are named as a verb and an object and carry no harness noun (hook, commit, session, task, extension).

### Harness ports (H1 to H12)

| #   | Port            | Methods                            | Intent                                                                                                    |
| --- | --------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| H1  | `Ledger`        | `read`, `transact`, `modelContext` | Read a conversation's facts, decide, and commit the writes the decision asks for, together.               |
| H2  | `Turns`         | `start`, `retract`, `stop`         | Give the agent a turn under a request key, take back one that has not started, stop the current one.      |
| H3  | `Helpers`       | `message`, `awaitAnswer`, `stop`   | Message a child, wait for the answer of one of its runs, stop that run if it is still the child's active run. |
| H4  | `Jobs`          | `register`                         | Finish what a call started after it returns, across restarts.                                             |
| H5  | `Waits`         | `untilIdle`, `untilDone`           | Wait until a conversation has no run, or until an input submitted under a key has run to its end; waiting keeps no state. |
| H6  | `Memory`        | `remember`                         | Remember an answer from a person or a model so a restart never asks again.                                |
| H7  | `Clock`         | `now`                              | Read the time in whole milliseconds; nothing mints ids, they derive from keys.                            |
| H8  | `Tools`         | `register`                         | Put the package's model-only tools on the harness.                                                        |
| H9  | `ToolGate`      | `register`                         | Before a call runs, allow it, block it or change its arguments; after it ran, replace its result.         |
| H10 | `ContextFilter` | `register`                         | Leave unadmitted round entries out of the next model request.                                             |
| H11 | `RequestMeter`  | `register`                         | Meter every model request with its conversation's lineage; refuse a child's next one once its run reached the cap. |
| H12 | `Lifecycle`     | `register`                         | Let the package settle a conversation when it opens, before and after it is compacted and when it closes. |

The outbound ports (`ledger`, `turns`, `helpers`, `waits`, `memory`, `clock`) are bound per call. A tool call, a job
run and a lifecycle callback each receive their own `BoundPorts`, and once that call returns its asynchronous methods
reject, so hold no reference past it. The tool gate's handlers receive `GatePorts` instead, which is `memory` and
`clock` only.

The other six ports (`jobs`, `tools`, `toolGate`, `contextFilter`, `requestMeter`, `lifecycle`) are inbound: each has
only `register`, called at install (in the contract, by the `install` callback, at open and again after every
restart). The harness calls the registered handlers when it has something to decide. The Agent Note lists `Jobs` with
the outbound ports because jobs are created by the `ensure-job` operation of `Ledger.transact`, but the port itself
only says what a job kind runs. A Durable adapter still supplies `ContextFilter` but never consults its handler.

`PortMethod` names every harness method as `port.method`; the contract must cover each one.

A child's run is what one run-starting input begins: an input that finds the child idle starts a run, and a message to
a running child (a steer) joins the run in progress and never starts one: a steer that misses its run's last boundary,
or that names a run no longer active, is withdrawn (G-C5). Runs are numbered from 1 in that order, `Helpers.message`
reports the run a message was accepted into, and `ChildFacts.runUsage[i]` sums the usage of the child's own entries of
run `i + 1`. `Helpers.awaitAnswer` is bound to the message key.

On reopen the harness restores every conversation with its runs and jobs, and `Lifecycle.onOpen` decides what to stop.
Inside `onOpen` the package calls only `ledger.*`, `turns.stop`, `helpers.stop` and `clock.now`; a stop there ends the
interrupted run as aborted before any resumed work (H12, stop before resume), and no conversation's run resumes before
its own `onOpen` has run. On Durable a submit or a wait would enable scheduling first, so these stops are marks
(`Harness.abortTask`, `abortSubmission`); reading the clock enables nothing. Until resume the stopped run and its
foreground children may still appear active in the facts, so `onOpen` must not decide on facts read after its own stop.

`Lifecycle.onCompacted` may be called while a run is active, because coding-agent's automatic compaction fires inside
a run, and `LiveFacts.hostCallInFlight` may still be true when it starts. The handler must not `append-quiet` there; it
ensures the idle driver, which writes the compaction status once the conversation is idle.

### Host ports (P1 to P8)

The host (Cherry) implements these, and `createScriptedHost` does for tests. The four calls that wait for a person or
a model (`Approvals.ask`, `Questions.ask`, `Verifier.verify`, `Summarizer.summarize`) take `(request, signal)` and
wait until answered or the signal aborts. `Settings` and `Observation.emit` are synchronous. `Workspaces` arrives with
the worktree PR.

| #   | Port          | Methods                                                                                         | Intent                                                                                    |
| --- | ------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P1  | `Approvals`   | `facts`, `ask`, `outcomes`                                                                      | Ask a person whether a call may run; tell the rules how people answered before.          |
| P2  | `Questions`   | `ask`                                                                                           | Ask a person questions (AskUserQuestion).                                                 |
| P3  | `Models`      | `find`, `current`                                                                               | Find models by the name a person said; tell what a conversation's model is now (tool support, its key, the key a child gets by default). |
| P4  | `Verifier`    | `verify`                                                                                        | Judge whether a goal is met.                                                              |
| P5  | `OutputStore` | `save`                                                                                          | Store an oversized output and return a path the model's read tool can open.               |
| P6  | `Summarizer`  | `summarize`                                                                                     | Write a compaction summary with the host's model.                                         |
| P7  | `Observation` | `emit`                                                                                          | Tell the host what happened, for display only; results never reach a parent through here. |
| P8  | `Settings`    | `goalDefaults`, `autonomy`, `permissionMode`, `attendance`, `maxBackground`, `offloadThreshold` | Settings read once per decision.                                                          |

## Keys

Every operation and keyed effect carries a `Key`, and every `Key` is a pure function of facts: nothing mints an id.
Only `src/core/keys.ts` mints a `Key`; an ESLint rule rejects the cast in `core/` and `orchestration/`, and only
contract cases mint test keys. `keys`, `armSeq`, `idleDriverGeneration` and `nextRun` live in that module and are not
exported: adapters pass keys through unchanged. An adapter restores a call key from its harness with `callKeyOf`,
which throws `TypeError` for an empty or blank value.

In each format the one free-form id comes first and only colon-free numbers, fixed words or a hash follow, so ids
containing `:` stay apart.

| Member                                                     | Format                                                                 | Identifies                                                                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `goalFromCall(call)`                                       | `goal:call:<call>`                                                     | A goal a tool call creates.                                                                                                                           |
| `goalFromCommand(requestKey)`                              | `goal:cmd:<requestKey>`                                                | A goal the `/goal` command creates, from the host's request key. The two prefixes differ, so a call key equal to a request key names another goal.   |
| `goalRound(goalId, round, revision, armSeq)`               | `goal-round:<goalId>:r<round>:v<revision>:a<armSeq>`                   | One goal round.                                                                                                                                       |
| `goalAdmit(roundKey)`                                      | `goal-admit:<roundKey>`                                                | The admission of that round.                                                                                                                          |
| `subagentSpawn(call)`                                      | `subagent-spawn:<call>`                                                | Spawning a child from a tool call.                                                                                                                    |
| `subagentMessage(child, run)`                              | `subagent-msg:<child>:<run>`                                           | The message that starts or continues run `run` of `child`; the request id for `Helpers.message`.                                                      |
| `subagentEnd(child, run)`                                  | `subagent-end:<child>:<run>`                                           | The record of how that run ended.                                                                                                                     |
| `subagentNotify(parent, runs)`                             | `subagent-notify:<parent>:<sha256 hex>`                                | One notification of finished runs. The hash is of the JSON of the batch's `[child, run]` pairs sorted by child, then run, so the order does not matter. |
| `turnStop(requestKey)`                                     | `turn-stop:<requestKey>`                                               | A user stop.                                                                                                                                          |
| `idleDriver(thread, generation)`                           | `idle-driver:<thread>:g<generation>`                                   | The thread's `idle-driver` job of that generation; `generation` is `idleDriverGeneration(history)`.                                                   |
| `idleDriverExit(thread, generation)`                       | `idle-driver-exit:<thread>:g<generation>`                              | The exit record that driver writes in the transaction that decides it stops.                                                                          |
| `subagentReport(runKey)`                                   | `subagent-report:<runKey>`                                             | A run's `subagent-report` job. `runKey` is the new run's spawn key, an in-place continuation's message key, or a forked continuation's `subagentContinue(call)` key, because a spawning commit has no child id yet. |
| `approvalMemo(call)`, `askMemo(call)`, `verdictMemo(call)` | `cherry.approval:<call>`, `cherry.ask:<call>`, `cherry.verdict:<call>` | `Memory` names for an approval, an AskUserQuestion answer and a verifier verdict.                                                                     |
| `summaryMemo(compactionKey)`                               | `cherry.summary:<compactionKey>`                                       | The `Memory` name of a compaction summary.                                                                                                            |
| `goalCall(call)`                                           | `goal-call:<call>`                                                     | The goal record a goal tool call writes; one per call, so a rerun finds it.                                                                           |
| `goalCommand(requestKey)`, `goalNotice(requestKey)`        | `goal-cmd:<requestKey>`, `goal-notice:<requestKey>`                    | The goal record and the notice a `/goal` command writes.                                                                                              |
| `goalStop(goalId, revision, armSeq)`                       | `goal-stop:<goalId>:v<revision>:a<armSeq>`                             | A stop the core decides outside a call (the idle driver, `onOpen`); a stop disarms and bumps the revision.                                            |
| `goalDisarm(goalId, armSeq)`                               | `goal-disarm:<goalId>:a<armSeq>`                                       | Disarming that arming of the goal when its conversation reopens.                                                                                      |
| `goalCounts(goalId, revision, progressRounds)`             | `goal-counts:<goalId>:v<revision>:p<progressRounds>`                   | A record that only refreshes the counts a goal shows.                                                                                                 |
| `subagentSteer(call, run)`, `subagentContinue(call)`       | `subagent-steer:<call>:<run>`, `subagent-continue:<call>`              | A `message_subagent` call's steer for that run of a running child (its request id), and the record of a continuation.                                 |
| `subagentStop(child, run, by)`                             | `subagent-stop:<child>:<run>:<by>`                                     | The record that the model, the user or the budget stopped that run, written before the child stops.                                                   |
| `subagentStatus(compaction)`                               | `subagent-status:<compaction item>`                                    | The status message after that compaction.                                                                                                             |
| `reopenStop(round)`                                        | `reopen-stop:<round item>`                                             | The stop `onOpen` records for the goal round a restart interrupted.                                                                                   |

Three helpers read the history. `armSeq(history, goalId)` counts how often the goal went from unarmed (or unrecorded)
to armed, so a goal resumed after a reopen keeps its revision but gets new round keys. `idleDriverGeneration(history)`
counts the thread's `idle-driver-exit` records, so the driver after an exit gets a new key. `nextRun(history, child)`
is one past the highest run recorded for the child, or 1.

Rules adapters rely on:

- `ConversationFacts.keysSeen` holds the keys of the thread's own entries (records and markers carry theirs as
  `data.key`) and the keys of live jobs ensured by a transaction on that thread. A spawn's key is on the parent's run
  record and on the child's origin record. A job's key stays while the job lives and leaves when it finishes, fails or
  is abandoned; a restart abandons an `'abandon'` job from the reopen on, before `onOpen`, and resumes a `'resume'`
  job. Once its job has ended, the key creates a new job.
- Dropping an operation whose key is already in `keysSeen` is the caller's job, done inside `decide`.
- `Turns.start` and `Helpers.message` take the key as the request id. The same key returns the original admission and
  never adds a second input, also after its run ended. A `busy` answer records nothing, so its key stays usable. A
  withdrawn key is spent: reserving again needs a new key.
- The idle driver's final decide, the one that decides it stops, writes its `idle-driver-exit` record under
  `idleDriverExit(thread, generation)` in that same transaction. An ensure committed before it is seen by that decide,
  so the driver goes on; one committed after it computes the next generation and creates a new job, so no wakeup is
  lost. Jobs are therefore deduplicated by key, never by kind.
- `Memory` names carry the `cherry.` prefix because hooks and tasks share one memo namespace on Durable.

## Entry kinds

`ENTRY_KINDS` names the custom entry kinds. A record never enters the model's context; a marker does. The first eight
kinds keep the `customType` strings agent-runtime-pi writes today, so stored sessions need no migration;
`cherry.plan`, `cherry.turn-stop` and `cherry.idle-driver-exit` are new. Durable refuses only `pi.` kinds, so all
eleven are storable there.

| Fact (`type`)           | Kind (`ENTRY_KINDS.` member)                            | Class  | Stored `data`                                  | `decodeEntry` needs                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------- | ------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `goal`                  | `cherry.goal` (`goal`)                                  | record | `GoalSnapshot` or `GoalCleared` fields, `key?` | `id` string and `revision` number; with `cleared`: `cleared` is `true` and `at` a number; otherwise `phase` is active, paused, blocked or complete and `armed` a boolean |
| `goal-notice`           | `cherry.goal-notice` (`goalNotice`)                     | record | `GoalNotice` fields, `key?`                    | `text` string; `level` is info or error                                                                                                                                |
| `subagent-run`          | `cherry.subagent-state` (`subagentRun`)                 | record | `SubagentRunRecord` fields, `key?`             | `sessionId` string, `run` number, `status` running or finished; `outcome` and `stoppedBy`, when present, members of `SubagentOutcome` and `SubagentStopper`              |
| `subagent-origin`       | `cherry.subagent-origin` (`subagentOrigin`)             | record | `SubagentOrigin` fields, `key?`                | `parentToolCallId`, `description`, `modelKey` strings; `fork` boolean                                                                                                  |
| `plan`                  | `cherry.plan` (`plan`)                                  | record | `PlanState` fields, `key?`                     | `active` boolean, `at` number                                                                                                                                          |
| `turn-stop`             | `cherry.turn-stop` (`turnStop`)                         | record | `{ cause, at, key? }`                          | `at` a number; `cause` is user, goal-command or reopen                                                                                                                 |
| `idle-driver-exit`      | `cherry.idle-driver-exit` (`idleDriverExit`)            | record | `{ generation, key? }`                         | `generation` a number                                                                                                                                                  |
| `goal-round`            | `cherry.goal-round` (`goalRound`)                       | marker | `RoundDetails` fields, `key?`                  | `id`, `goalId` strings; `revision`, `round` numbers; `kind` is work, hint or wrap-up                                                                                   |
| `subagent-notification` | `cherry.subagent-notification` (`subagentNotification`) | marker | `{ subagents, quiet, key? }`                   | `subagents` an array whose items have `sessionId` string, `run` number, `outcome` a `SubagentOutcome`, and `stoppedBy`, when present, a `SubagentStopper`              |
| `subagent-status`       | `cherry.subagent-status` (`subagentStatus`)             | marker | `{ key? }`                                     | Nothing; `data` may be missing                                                                                                                                         |
| `subagent-message`      | `cherry.subagent-message` (`subagentMessage`)           | marker | `{ key? }`                                     | Nothing; `data` may be missing                                                                                                                                         |

Write a record or marker with `encodeEntry(fact, key)`. It returns the `{ kind, data }` to store, with `key` as one
extra `data` field when given (Durable: `tx.appendEntry({ kind, data })`). A `TurnInput` already has its `kind` and
`data` laid out by the same encoder; when the harness stores one it merges its request key into `data` as `key`.

Read every stored entry of a custom kind with `decodeEntry({ id, kind, data, text })` and skip the entries for which
it returns `undefined`. It returns `undefined` for a kind outside `ENTRY_KINDS`, for `data` that is not an object (a
missing or null `data` reads as an empty object), for a `key` that is not a string, and for data that fails the checks
above. It does not throw and does not validate fields beyond those checks. A record decodes to
`{ kind: 'record', id, key?, record }`, with `key` lifted out of `data`; a marker to
`{ kind: 'marker', id, key?, marker, text }`, with `text` as stored or `''`. A decoded notification keeps `sessionId`,
`run`, `outcome` and `stoppedBy` of each run, drops the per-run `usage` that older entries carry, and reads any `quiet`
other than `true` as `false`. The adapter maps the other history entries (user, assistant, tool result, compaction) to
`HistoryEntry` itself, as [History projection](#history-projection) describes.

## Applying a step

`Ledger.transact` applies the operations of the `Step` that `decide` returns, all in one commit, and rejects, writing
nothing, when one cannot apply. The orchestration has already dropped every operation whose key is in `keysSeen`.

| Operation       | How the adapter applies it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | What it leaves in `keysSeen`                                                                                                                                                                     | Contract cases                                                                                                                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `append-record` | Store `encodeEntry(record, key)` on `op.thread` as an entry that never enters the model context (coding-agent: `pi.appendEntry(kind, data)`; Durable: `tx.appendEntry(conv, { kind, data })`). On Durable a `plan` record is also mirrored to a document in the same commit, because `beforeTool` reads plan state from documents.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `data.key` of the new entry, on `op.thread`.                                                                                                                                                     | `transact writes nothing when decide or an operation throws`; `applied operation keys are visible in keysSeen`; `the gate sees plan state and the goal round's call window`                                                                                                         |
| `append-quiet`  | Add `op.input` to `op.thread` as a marker the model sees without starting a run: its `kind`, its `data` with `key` merged in, and its `text`. In the same commit check that no run is active and the inbox is empty, and reject the whole transaction otherwise. coding-agent: `pi.sendMessage(message, { triggerTurn: false })`; Durable: read `pi.live` and `pi.inbox`, then raw-append `{ kind, data, model: [user text] }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `data.key` of the marker, on `op.thread`.                                                                                                                                                        | `applied operation keys are visible in keysSeen`; `records stay out of the model context; quiet inputs enter it`; `quiet inputs are refused while a run is active`                                                                                                                  |
| `spawn-child`   | Create a child of the transacting thread. `spec.boundary` sets ownership: a foreground child belongs to the current tool call and stops with it (Durable: `ownership: { kind: 'task', taskId }`); a background child hangs under the background anchor. With `spec.fork`, the child starts with `fork.from`'s history up to and including `fork.at`. In the same commit and under the op key, write the child's `subagent-origin` record (`spec.origin`) and the parent's `subagent-run` record (`spec.record` with `sessionId` set to the new child). Configure the child with the model `origin.modelKey` names and with the parent's tool definitions filtered by `availability`: a `'parent-only'` tool is not registered in the child, and nothing is filtered by tool name (Durable: `configure` with the extension array `api.agent()` resolves); `ChildSpec` carries no such settings, so this is the adapter's job. Report `{ key, child }` in `TransactResult.spawned`. A fork always creates a new conversation with a new id (never `fork.from` itself): run numbers and `subagent-end` keys are per conversation, so continuing in place would collide with the source's earlier runs. | The op key, on the parent's run record and on the child's origin record.                                                                                                                         | `applied operation keys are visible in keysSeen`; `foreground children stop with the parent turn; background children do not`; `a parent-only tool runs for the parent and is absent from a spawned child`. No case covers `fork` yet.                                              |
| `ensure-job`    | Create a job of `job.kind` for its registered handler unless a live job already has the op key; deduplicate by key, never by kind (coding-agent: an in-process promise; Durable: `tx.createTask` of `cherry.job`, owned by the conversation, `background: true`, with `abandonOnRestart` for `'abandon'`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | The op key, on the transacting thread, while the job lives. It leaves when the job finishes, fails or is abandoned (from the reopen on, before `onOpen`), and the key can then create a new job. | `applied operation keys are visible in keysSeen`; `resume jobs rerun from the start after a restart; abandon jobs are dropped`; `a job key is usable again once its job has ended`; `an ensure under the next driver generation creates a job while the previous driver is exiting` |

The tool gate reads the same history through `GateFacts`. `plan` is the latest `plan` record (Durable: the mirrored
document). `goalRound` says whether the call's run started from a `cherry.goal-round` input: coding-agent reads it from
the branch; Durable from the run's first input, through the late-bound `Conversation.entries()` of harness-limited row
5; the fake from the run's starting input. `GateCall.nested` says whether another tool made the call, and every adapter
reports it truthfully: on Durable the call has a `parent`; on coding-agent (Pi 1.3.0) a call made through
`ctx.executeTool` carries a `parentToolCallId`. `before` and `after` receive the same `GateCall`, `nested` included
(`after` with the arguments the call ran with); `GateFacts` does not repeat it. The fake makes no nested calls, so it is
`false` there.

### History projection

The adapter projects its stored history into `HistoryEntry`, decoding custom kinds with `decodeEntry`. A `user` entry
carries the text of the person's message. The `text` of `user` and `assistant` entries (and of tool results and markers)
is what `vcc_recall` numbers and searches, so an image appears in it as `[image]` and an assistant's thinking is left
out. Every tool call (a `ToolCallFact` in an assistant entry's `toolCalls`) and every `tool-result` carries `callKey`:
the adapter computes it with `callKeyOf` from the same id as the gate's `GateCall.key` (Durable: the tool task id;
coding-agent: `<sessionId>:<toolCallId>`), so a call, its result and the host's approval outcomes for it share one key;
the case `a tool call and its result read back under the gate's call key` asserts it. Two mappings are easy to miss:

- Durable records a call the gate blocked as a tool result whose text is `Tool call blocked: <reason>`. Project it as a
  `tool-result` with `isError: true` and that text; the gate cases look for the reason in it.
- coding-agent stores markers as `custom_message` entries and records as `custom` entries. Pass `customType` as
  `RawEntry.kind`; for a `custom_message`, `details` as `RawEntry.data` and the text of `content` as `RawEntry.text`;
  for a `custom` entry, its `data` as `RawEntry.data`.

## The rule core

`core/` holds the rules, and the `orchestration/` of a later PR calls them. For one decision the orchestration fills a
`CallInputs`, runs `Ledger.transact(thread, (facts) => decide(facts, inputs, ...))`, and then runs the `effects` of the
returned `Step` in order, as [Applying a step](#applying-a-step) describes for its operations. A rule reads only
`ConversationFacts` and `CallInputs` and keeps nothing between calls: every decision recomputes from the full history,
and a rerun with the same facts and key decides the same thing. A rule that must recognise a rerun looks for its own key
in the history (the goal tools, `decideSpawn`, `decideMessage`, `decideRunEnd`, `admitRound`, the compaction status);
the caller drops any other operation whose key is in `keysSeen`. The one throw is a wiring mistake, `decideSpawn`
without `CallInputs.models`, after which the commit writes nothing. No rule function is exported.

| Folder         | Decision entry points                                                                                                                                                                                                                                                                            | Serves                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `goal/`        | `decideGoalCommand(facts, inputs, text, requestKey)`; `decideGetGoal(facts)`, `decideCreateGoal(facts, inputs, call)`, `decideUpdateGoal(facts, inputs, call)` with `unverifiedText(reason)`; `unadmittedRoundItems(history)`                                                                    | The `/goal` command; the tools `get_goal`, `create_goal`, `update_goal`; the context filter.                                                                                                                   |
| `subagents/`   | `decideSpawn`, `decideMessage` (both `(facts, inputs, call)`), `decideStop(facts, inputs)`; `decideUserStopSubagent(facts, child)`; `reportTarget(facts, input)` and `decideRunEnd(facts, child, run, answer, report)`; `allowRequest(requestsInRun, lineage)`; `interruptRoute(history, child)` | The tools `subagent`, `message_subagent`, `stop_subagent`; the host's stop of a background child; a run's end, foreground or in its `subagent-report` job; the request meter; the host's interrupt of a child. |
| `approval/`    | `repeatBlock(call, gateFacts)`; `decideApproval(call, host, mode, attendance, plan)`; `answerVerdict(answer, args)`                                                                                                                                                                              | The tool gate's `before`.                                                                                                                                                                                      |
| `interaction/` | `decideAskUser(lineage, args)` with `askUserResult(questions, answer)`; `decideTodos(args)`                                                                                                                                                                                                      | The tools `AskUserQuestion` and `todo_write`.                                                                                                                                                                  |
| `context/`     | `recallText(history, args)`; `offloadPlan(call, result, threshold)` with `offloadMarker(content, saved)`; `summaryDecision(summary)`                                                                                                                                                             | The tool `vcc_recall`; the tool gate's `after`; a compaction summary.                                                                                                                                          |
| `driver/`      | `decideAtIdle(facts, inputs)` with `admitRound(facts, inputs, start)`; `decideOnOpen(facts, inputs, open)`; `decideUserStop(facts, inputs, requestKey)`; `ensureDriver(facts)`, `ensureReport(facts, input)`                                                                                     | The `idle-driver` job; `Lifecycle.onOpen`; the host's `userStop` entry; the operations that start the two jobs.                                                                                                |

Tool arguments arrive as plain JSON, so each rule checks their shape itself (`args.ts`) and reports a mistake in its own
text; the tools' names, descriptions and schemas belong to the orchestration, which registers the three subagent tools
as `'parent-only'`. `turns.ts` holds `startsTurn`, the one definition of which history entry begins a run: a person's
message, a goal round, or a notification that is not quiet. Plan mode is read here, never written: the gate blocks edits
and calls that would ask a person while the latest `plan` record is active, `decideAtIdle` starts no round while the
host's permission mode is `plan` or that record is active, and the tools that write the record come later.

### Gathering the inputs

| `CallInputs` field | The orchestration fills it from                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `now`              | `Clock.now()`.                                                                                                                                                                                                               |
| `settings`         | `Settings`, each getter read once for the decision.                                                                                                                                                                          |
| `approvals`        | `Approvals.outcomes(thread, [])`; for the idle driver also `Approvals.outcomes(child, [])` of each child. A goal round's stop request matches its calls by `callKey`; a child with a `pending` outcome is awaiting approval. |
| `models`           | `subagent`: the keys from `Models.current(thread)`, plus `Models.find(name)` when the call names a model. `decideOnOpen` takes `supportsTools` from `Models.current(thread)` as its own argument instead. |
| `verdict`          | `update_goal` with `complete`: the verifier's verdict, below.                                                                                                                                                                |
| `args`             | The tool call's final arguments.                                                                                                                                                                                             |

`Approvals.facts` fills `ApprovalHostFacts` for `decideApproval`; the host computes `withinAllowedRoots` per permission
mode and tool category. The tool gate's `after` hands the `GateCall` it received to `offloadPlan` as it is, `nested`
included.

### Acting on a decision

The effects of a `Step` run after its commit, in order:

| Effect          | Run as                                    |
| --------------- | ----------------------------------------- |
| `start-turn`    | `Turns.start(thread, input, key)`         |
| `retract-turn`  | `Turns.retract(thread, key)`              |
| `stop-turn`     | `Turns.stop(thread, cause)`               |
| `message-child` | `Helpers.message(child, input, key, run)` |
| `stop-child`    | `Helpers.stop(child, run)`                |
| `emit`          | `Observation.emit(event)`                 |

What the caller does with the result of each entry point:

- `decideAtIdle` decides once per wake of the `idle-driver` job, and the job loops on it. `wait` (`user-first`,
  `host-call` or `busy`) wrote nothing: await `Waits.untilIdle`, then decide again. `stop-children`, `stop-goal`,
  `status` and `quiet` only need their operations and effects applied: then decide again. `notify` and `start-round`
  carry a `start-turn` effect: run it, and a `busy` answer (nothing was recorded) sends both back to the loop alike.
  Once `start-round` was taken, commit `admitRound(facts, inputs, { round, key })`: it admits the round, or withdraws it
  with a `retract-turn` effect, and when `Turns.retract` answers `already-started` the caller stops that run with
  `Turns.stop(thread, 'goal-withdraw')`. Taken either way (`started` or `queued`), both then await
  `Waits.untilDone(thread, key)` before deciding again: an input queued behind a failed run's leftovers runs later, and
  deciding before it ran would see the same facts. `done` wrote the driver's `idle-driver-exit` record in the same
  transaction: end the job.
- `update_goal` with `complete` takes two decisions. The first returns a `VerifyDraft` (`{ verify }`) and writes
  nothing; judge it with `Verifier.verify` behind `Memory.remember(keys.verdictMemo(call), ...)`, then decide again with
  `CallInputs.verdict`. When the verifier fails, write nothing and answer an error result with `unverifiedText(reason)`.
- `/goal` always answers with a notice, never a model turn. The command has no rerun guard: before deciding, the host
  entry checks `keysSeen` for `keys.goalNotice(requestKey)` and, when it is there, answers with that notice instead of
  deciding again.
- `subagent` (`decideSpawn`): read the new child from `TransactResult.spawned` under the result's `key`, or from its
  `child` when this call already spawned it. A background spawn created its `subagent-report` job in the same commit; a
  foreground one is messaged and awaited by the calling tool. Either way a run's input goes through
  `Helpers.message(child, input, keys.subagentMessage(child, run))`, and its end through
  `Helpers.awaitAnswer(child, run, thatKey)` and then `decideRunEnd(facts, child, run, answer, runReport(answer))`. The
  `subagent-report` job finds its run with `reportTarget`, which is `undefined` once the end is recorded: exit.
- `message_subagent` (`decideMessage`): `queued` carries the `message-child` effect, a steer for the running run; when
  `Helpers.message` answers `withdrawn` (that run ended first), `transact(decideMessage)` again. `continued` is
  answered with `continuedText(from, child)`, where `child` comes from `TransactResult.spawned` under `key` when the
  result has none (a finished foreground child was forked into a new background child); `stopping` means that run is
  being stopped: await `Helpers.awaitAnswer(child, run, key)`, then `transact(decideMessage)` again.
- `stop_subagent` (`decideStop`): `stopping` is answered after `Helpers.awaitAnswer(child, run, key)` with
  `stoppedResult(child, run, answer)`; `not-running` and `ended` (no input had reached the run, G-C4) carry their own
  results.
- The tool gate's `before` gets `decideApproval`'s answer: `allow` runs the call (with `args` when the host rewrote
  them), `block` stops it with its `reason`, and `ask` asks a person through `Approvals.ask` behind
  `Memory.remember(keys.approvalMemo(call), ...)`, then maps the answer with `answerVerdict(answer, args)`;
  `repeatBlock` may also block with its own text. Its `after` asks `offloadPlan` for a file name: save the full text
  with `OutputStore.save`, and replace what the model sees with `offloadMarker(text, saved)`, giving `{ error }` when
  the save failed.
- `AskUserQuestion` (`decideAskUser`) either answers at once (`answered`, an error result for a malformed call or a
  subagent) or returns the `questions` to ask: `Questions.ask` behind `Memory.remember(keys.askMemo(call), ...)`, then
  the result is `askUserResult(questions, answer)`, with `answer` `undefined` when the turn was aborted while waiting.
- After every step that touches a subagent, emit `subagentViews(await ledger.read(thread), approvals)` as an
  `Observation`: the decisions carry no view event, since a spawning step does not know the child's id yet.
- `decideOnOpen` runs in `onOpen`, before any resumed work, so its effects are the stops described under
  [Ports](#ports). Every user stop of the host (the stop button, the foreground stop a child thread's interrupt turns
  into, any stop that does not come through `/goal`) goes through `decideUserStop`: a goal's `aborted` judgement and the
  suppression of waking results read only `turn-stop` records, so a stop that bypasses it lets the goal start another
  round and the results wake the agent as usual.
- When the host leaves plan mode (it switches the permission mode, or a later `exit_plan_mode`), ensure the idle driver
  with `ensureDriver`: `decideAtIdle` answers `done` while plan mode is on and the driver has exited, so an armed goal
  would otherwise stay still.

### What the adapters provide

Beyond [History projection](#history-projection):

- A `tool-result` entry's `details` is projected unchanged: the rules read `blockedReport` from an `update_goal` result
  and `outcome` from an `AskUserQuestion` result.
- When `Waits.untilIdle` resolves, `LiveFacts.runEnd` is already the run that just ended; `ChildFacts.lastItem` is the
  child's last history entry.

## Running the contract in an adapter

`harnessContract` is the list of cases every harness must pass. A case is a plain async function over an opened harness
(no test framework) with a `name` that states the contract, the port methods it `covers` and the `needs` it
requires. The adapter supplies an `OpenContractHarness`, which opens a fresh harness around its own storage and model,
and runs each case:

```ts
import { harnessContract, type OpenContractHarness } from '@cherrystudio/agent-behavior'
import { describe, it } from 'vitest'

const open: OpenContractHarness = async (install) => createAdapterTestHarness(install)
const lacks = new Set(['restart']) // coding-agent: runs do not resume (agent-runtime-pi README)

describe('agent-behavior harness contract', () => {
  for (const contractCase of harnessContract)
    (contractCase.needs.some((need) => lacks.has(need)) ? it.skip : it)(contractCase.name, () => contractCase.run(open))
})
```

`createAdapterTestHarness` is the adapter's own: it builds its harness and returns a `ContractHarness`. `install` is
called with the adapter's `HarnessPorts` at open and again after every restart, and registers the handlers the case
needs (tools, jobs, tool gate, context filter, request meter, lifecycle). The harness must honour each one.

`ContractHarness` obligations:

| Method                    | The harness must                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createThread()`          | Create a root conversation; `onOpen(thread, { reopened: false }, ports)` has run for it when the promise resolves.                                                                                                      |
| `withCall(thread, use)`   | Run `use` with outbound ports bound to a fresh job-like call on `thread`; they expire when `use` settles.                                                                                                               |
| `script(thread, replies)` | Append the replies the model gives `thread`'s runs, in order; a request past the end fails its run. A reply is text with optional tool calls and `usage`, or `{ error }`, a failed request.                              |
| `sendUser(thread, text)`  | Deliver a person's text as user input; if the conversation is busy it stays in the inbox and is handled with leftover semantics.                                                                                        |
| `compact(thread)`         | Compact `thread` now, a manual compaction: ask `onCompacting`, and with a summary add a compaction entry and call `onCompacted`; a decline leaves the history as it was.                                                |
| `settle()`                | Resolve once no run is active and no job is live; inbox items a failed run left do not count.                                                                                                                           |
| `restart()`               | Lose everything in memory and reopen from storage: install runs again, `abandon` jobs are dropped, `onOpen(thread, { reopened: true }, ports)` runs for every conversation, then runs and `resume` jobs continue.     |
| `close()`                 | Call `onClose` for every conversation, then shut down.                                                                                                                                                                  |

A harness may skip only the cases whose `needs` it lacks, and `needs` has two values:

- `restart`: coding-agent skips these, because its runs do not resume.
- `context-filter`: Durable skips this, because it never consults `ContextFilter` (H10: with idle-driver rounds an
  unadmitted round never enters history).

The case `start queues behind inbox items a failed run left, and retract withdraws it` assumes Durable's default
`followUpMode: 'one-at-a-time'`. With `'all'`, the new input would start together with the leftover and could no longer
be withdrawn.

Every other difference between harnesses is a row of the Agent Note's
[Capabilities limited by the harness](../../.agents/notes/proposed/architecture/2026-10-18-agent-behavior-package.md#capabilities-limited-by-the-harness)
table, and an adapter declares it by citing that row.

A change to the set of harness port methods must change the fake and add or extend a contract case in the same PR.
`src/contract/portMethods.ts` lists every method as `HARNESS_PORT_METHODS`. The typecheck fails when that list and
`PortMethod` differ, and `tests/contract/coverage.test.ts` fails when a listed method is in no case's `covers`.
`tests/contract/fake.test.ts` runs every case on the fake and skips none. Each case is preceded by a `// Catches ...`
comment naming the bug it catches.

## The fake and the scripted host

`createFakeHarness(options)` is a complete in-memory harness. It implements `ContractHarness`, so every contract case
runs on it, and adds controls for the tests that build on it. Options, all optional:

- `install(ports)`: registers handlers at creation and again after every restart.
- `scripts(thread, lineage)`: seeds the script of each conversation as it is created, children created inside jobs
  included.

Beyond `ContractHarness` it offers:

- `awaitPoints`: await points passed since creation. Every outbound port call, every model request and every tool call
  of a run is one; `clock.now` is not.
- `crashAt(n)` and `whenCrashed()`: crash at the n-th await point from now (1-based). That point and all later work of
  the current epoch never settle. `whenCrashed()` resolves when the armed crash fires, and is already resolved if it
  has.
- `persistentLog()`: the persistent state as sorted JSON (entries, submissions by key, the memo table, the job table),
  for crash-equivalence checks.
- `requestLog(thread)`: the ids of the entries each model request on `thread` saw, after the context filter.

`restart()` loses what a Durable restart loses (handlers, run loops, running jobs, waiters) and keeps what it keeps
(entries, submissions, memo, the job table, the final arguments of tool calls). `abandon` jobs are dropped first. Every
conversation then gets `onOpen(reopened: true)` before any resumed work. A stop there only marks the restored run,
which stays active in the facts until resume ends it as aborted, and a job ensured there starts once every `onOpen` has
run. Then runs resume: a tool call cut in the middle reruns with its final arguments when its tool is `replay: 'safe'`,
and gets an interrupted result when the tool is `'unsafe'` and the call had reached it. `resume` jobs rerun from the
start.

The fake fails fast on wiring mistakes. An `ensure-job` for a kind with no registered handler rejects the transaction,
as does a foreground `spawn-child` outside a tool call; a call to a tool that is not registered, or to a
`'parent-only'` tool from a child, returns an error result. Inside `onOpen` on reopen, every port method outside
`ledger.*`, `turns.stop`, `helpers.stop` and `clock.now` rejects with an error naming it. A script that runs out fails
the next model request with `script exhausted`. After `close()`, the harness and its ports fail.

To check that a flow survives a crash at any step, sweep the crash over every await point, as
[`tests/fake/crashSweep.test.ts`](tests/fake/crashSweep.test.ts) does for a keyed report job:

1. Run the flow once without a crash. Note the await points it spent and keep `persistentLog()` as the expected state.
2. For each point `n`, build a fresh fake, call `crashAt(n)` before the call that starts the flow (it counts from now,
   and a job starts passing await points as soon as its commit returns), and race `settle()` against `whenCrashed()`
   to confirm the crash fired.
3. Call `restart()` and `settle()`, then compare `persistentLog()` with the expected state. Item ids come from a global
   counter and may shift after a restart, so strip them before comparing.

`createScriptedHost(options)` implements `HostPorts` for tests and is independent of the fake harness.
`options.settings` (a `HostSettingsSnapshot`) is required; `models` (default none), `supportsTools` (default true) and
`modelKeys` (default `scripted/parent-model` and `scripted/child-model`), which `Models.current` answers, and
`approvalFacts` (default: category `other`, everything else off) are optional. Its controls:

- `answerApproval`, `answerQuestion`, `giveVerdict`: queue an answer, first in, first out. A request with nothing
  queued stays pending until an answer is given or its signal aborts, which rejects it with the signal's reason. An
  answer queued earlier is taken by the next request.
- `giveSummary`: queue a summary. `summarize` takes the oldest at once and rejects when none is queued; it never waits.
- `setSettings(patch)`: replaces settings for later reads.
- `asked`: how many times approvals, questions, verdicts and summaries were requested. `emitted`: the `BehaviorEvent`s
  in order. `saved`: every `OutputFile` saved.

While an approval is pending, `Approvals.outcomes` reports it as `pending`; once answered, as `granted`, `denied`
(with feedback) or `unavailable`. `OutputStore.save` returns `outputs/<name>`.

## Validation

```sh
pnpm --filter @cherrystudio/agent-runtime build
pnpm test:agent-behavior <test files>
pnpm --filter @cherrystudio/agent-behavior typecheck
```

Pass explicit test file paths under `packages/agent-behavior/tests/`. `typecheck` resolves `@cherrystudio/agent-runtime`
types from its built `dist/`, hence the first command, and runs `tsc` twice: once over the package and once over
`src/core/` alone with no Node or DOM types, which keeps core free of the environment. The lint guards for imports,
layers and key minting have their own test:
`pnpm test:scripts scripts/__tests__/agent-behavior-boundary.test.ts`.
