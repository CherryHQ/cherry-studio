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

| Directory        | Holds                                                                                                                                                                                   | Rule                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`          | Facts, host facts, entry codecs, `Step` / `TxOp` / `Effect`, key derivation, `sha256Hex`, and the rule topics `goal/`, `subagents/`, `approval/`, `interaction/`, `context/`, `driver/` | Synchronous and pure: imports no other layer, has no `async`, `await`, `Promise` or `yield`, and touches no clock, randomness, process, `fetch` or timers.     |
| `ports/`         | The harness ports (`harness.ts`) and the host ports (`host.ts`)                                                                                                                         | Interfaces and TSDoc only; imports core types only.                                                                                                            |
| `orchestration/` | `install`: the tools, jobs, tool gate, lifecycle handlers and host entries                                                                                                              | Runs the rules over the ports: one decision per `Ledger.transact`, then the step's effects in order; no module or instance state, no timers, no `new Promise`. |
| `fake/`          | `createFakeHarness`, `createScriptedHost`                                                                                                                                               | The in-memory second implementation of the ports.                                                                                                              |
| `contract/`      | `harnessContract` and the `ContractHarness` an adapter implements                                                                                                                       | The cases every harness must pass.                                                                                                                             |

The rule functions live in `core/`: each topic folder maps facts to a `Step` or a plain result, synchronously and
without I/O, and none of them is exported ([The rule core](#the-rule-core)). `orchestration/` runs them over the ports,
and `install` is its only runtime export ([Installing the package](#installing-the-package)). Until PR-2 moves
agent-runtime-pi onto this package, goal and subagent semantics stay in the
[agent-runtime-pi README](../agent-runtime-pi/README.md). Three pure projections and three constants are exported for
adapters and the host: `delegationStatus(record)` gives `Delegation.status` for a run record,
`turnOrigin(history, item)` names who started the turn an entry belongs to (a person, a goal round or a notification),
`subagentViews(facts, approvals)` lists the background children as the host shows them, `DEFAULT_MAX_BACKGROUND` is
the default of the host's `Settings.maxBackground()`, and `FORK_PLACEHOLDER_RESULT` and `INTERRUPTED_CALL_RESULT` are
the texts of the results an adapter gives a child's open tool calls ([Applying a step](#applying-a-step)).

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
| H2  | `Turns`         | `start`, `retract`, `stop`         | Give the agent a turn under a request key, take back one that has not started, stop the current one or only the one a stop names. |
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

What a child's run is and how a steer joins one (H3), what `onOpen` may do on reopen (stop before resume) and when
`onCompacting` and `onCompacted` run (H12) are specified in those ports' TSDoc.

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
contract cases mint test keys. `keys`, `armSeq`, `idleDriverGeneration`, `withdrawGeneration` and `nextRun` live in
that module and are not exported: adapters pass keys through unchanged. An adapter restores a call key from its
harness with `callKeyOf`, which throws `TypeError` for an empty or blank value.

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
| `subagentNotify(parent, runs, stops)`                      | `subagent-notify:<parent>:s<stops>:<sha256 hex>`                       | One notification of finished runs. The hash is of the JSON of the batch's `[child, run]` pairs sorted by child, then run, so the order does not matter; `stops` is `withdrawGeneration(history)`, so a batch a stop withdrew is offered again under a new key. |
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

Four helpers read the history. `armSeq(history, goalId)` counts how often the goal went from unarmed (or unrecorded)
to armed, so a goal resumed after a reopen keeps its revision but gets new round keys. `idleDriverGeneration(history)`
counts the thread's `idle-driver-exit` records, so the driver after an exit gets a new key.
`withdrawGeneration(history)` counts the thread's `turn-stop` records: a stop withdraws queued input and spends its
key. `nextRun(history, child)` is one past the highest run recorded for the child, or 1.

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
| `spawn-child`   | Create a child of the transacting thread. `spec.boundary` sets ownership: a foreground child belongs to the current tool call and stops with it (Durable: `ownership: { kind: 'task', taskId }`); a background child hangs under the background anchor. With `spec.fork`, the child starts with `fork.from`'s history up to and including `fork.at`; when `fork.from` is the transacting thread (a fork subagent), a result for each call of the `fork.at` entry follows, with `FORK_PLACEHOLDER_RESULT` as its text and `isError: false`, while a fork of another conversation (S-j) leaves its open calls to the interrupted result below. In the same commit and under the op key, write the child's `subagent-origin` record (`spec.origin`) and the parent's `subagent-run` record (`spec.record` with `sessionId` set to the new child). Configure the child with the model `origin.modelKey` names and with the parent's tool definitions filtered by `availability`: a `'parent-only'` tool is not registered in the child, and nothing is filtered by tool name (Durable: `configure` with the extension array `api.agent()` resolves); `ChildSpec` carries no such settings, so this is the adapter's job. Report `{ key, child }` in `TransactResult.spawned`. A fork always creates a new conversation with a new id (never `fork.from` itself): run numbers and `subagent-end` keys are per conversation, so continuing in place would collide with the source's earlier runs. | The op key, on the parent's run record and on the child's origin record.                                                                                                                         | `applied operation keys are visible in keysSeen`; `foreground children stop with the parent turn; background children do not`; `a parent-only tool runs for the parent and is absent from a spawned child`. `a forked child counts no inherited entry as its own run or usage`, `a fork answers each call of its fork point with the placeholder result` and `an S-j fork answers the calls open at its fork point as interrupted, not as still running` cover `fork`. |
| `ensure-job`    | Create a job of `job.kind` for its registered handler unless a live job already has the op key; deduplicate by key, never by kind (coding-agent: an in-process promise; Durable: `tx.createTask` of `cherry.job`, owned by the conversation, `background: true`, with `abandonOnRestart` for `'abandon'`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | The op key, on the transacting thread, while the job lives. It leaves when the job finishes, fails or is abandoned (from the reopen on, before `onOpen`), and the key can then create a new job. | `applied operation keys are visible in keysSeen`; `resume jobs rerun from the start after a restart; abandon jobs are dropped`; `a job key is usable again once its job has ended`; `an ensure under the next driver generation creates a job while the previous driver is exiting` |

A child's history never hands its model a call without a result: before `Helpers.message` starts a run of a child,
the adapter answers each call of the child's last assistant entry that has none with `INTERRUPTED_CALL_RESULT` as its
text and `isError: true`, unless that entry ended in an error or was aborted (H3; the cases
`a message that starts a child run first answers the calls its last reply left open` and
`an S-j fork answers the calls open at its fork point as interrupted, not as still running`).

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

`core/` holds the rules. Each topic folder (`goal/`, `subagents/`, `approval/`, `interaction/`, `context/`, `driver/`)
maps `ConversationFacts` and `CallInputs` to a `Step` or a plain result, synchronously and keeping nothing between
calls, so a rerun with the same facts and key decides the same thing; a rule that must recognise a rerun finds its own
key in the history. Tool arguments arrive as plain JSON, and each rule checks their shape itself (`args.ts`).
`orchestration/` takes one step at a time: it gathers the host facts a decision needs into `CallInputs` (`gatherInputs`
in `step.ts`), decides inside one `Ledger.transact`, drops the operations whose keys `keysSeen` already holds, runs the
step's effects in order once the commit is in, and shows the host fresh `subagentViews` after a step that touched a
subagent. What each tool, job, gate and entry does with its decision is in `src/orchestration/`; what each rule decides
is in its TSDoc.

### What the adapters provide

Beyond [History projection](#history-projection):

- A `tool-result` entry's `details` is projected unchanged: the rules read `blockedReport` from an `update_goal` result
  and `outcome` from an `AskUserQuestion` result.
- When `Waits.untilIdle` resolves, `LiveFacts.runEnd` is already the run that just ended; `ChildFacts.lastItem` is the
  child's last history entry.

## Installing the package

`install(harness, host)` registers everything the package runs on a harness and returns the `Installation` the host
keeps. The adapter calls it with its `HarnessPorts` and the host's `HostPorts` when it opens, and again after every
restart, since registrations do not survive one. Nothing it returns holds state, so the entries of any installation
serve any call.

| Registered on   | What runs                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tools`         | The nine tools below.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `toolGate`      | `before`: the repeated-call block (D8), then approvals and the plan gate (D34, D35, D37). A person is asked through `Approvals.ask` once per call, memoized under `cherry.approval:<callKey>`. `call.signal` aborts when the call's turn stops: the ask is withdrawn, nothing is memoized (a rerun asks again) and the call is blocked with the text of `ASK_WITHDRAWN`. `after`: offload (D31).                                           |
| `jobs`          | `idle-driver`: wait until idle, decide (D38), run the step; a goal round `Turns` took is admitted or withdrawn. A start `Turns` refused as `busy` goes back to waiting; a `started` or `queued` one waits with `Waits.untilDone` until its input has run; `done` ends the job. `subagent-report`: unless the run's end is already recorded, send it its input (stopping the run at once if a stop came first), await its end, record it.   |
| `contextFilter` | Leaves unadmitted round markers out (D12), except the one that started the current run while that run is active: the driver admits a round only after `Turns` took it, so its first requests must see it, but a compaction or verifier after a round withdrawn before admission must not.                                                                                                                                                  |
| `requestMeter`  | Refuses a child's next model request once its run reached the request cap (D24); a root conversation has none.                                                                                                                                                                                                                                                                                                                             |
| `lifecycle`     | `onOpen`: `decideOnOpen`, then the subagent views again on reopen. `onCompacting`: the host's `Summarizer` writes the summary; a non-empty one is memoized under `cherry.summary:<key>` and returned, a failed or empty one declines with the summarizer's error or `The summary is empty` as its `reason`, and the harness then does not compact. `onCompacted`: ensures the idle driver, which exits at once, leaving one `idle-driver-exit` record, when there is no status to write. `onClose`: nothing yet. |

| Tool                                     | `replay` | `executionMode` | `availability` |
| ---------------------------------------- | -------- | --------------- | -------------- |
| `subagent`, `message_subagent`           | safe     | parallel        | parent-only    |
| `stop_subagent`                          | unsafe   | parallel        | parent-only    |
| `get_goal`, `create_goal`, `update_goal` | safe     | sequential      | all            |
| `AskUserQuestion`                        | safe     | sequential      | all            |
| `todo_write`, `vcc_recall`               | safe     | parallel        | all            |

Each schema carries the constraints today's tools have. The rules check the arguments again themselves, so a harness
that does not validate against the schema loses nothing.

`Installation.entries` is what the host calls. Each entry takes the ports of one host call (the adapter's `withCall`)
and, where it takes one, the host's key for the request, which makes a repeated call harmless. Those ports must read,
transact and stop on any conversation, not only the one the call was opened on: `stopSubagent` reads the child, then
commits on its parent and stops the child or the parent's turn (on Durable, the handle commits through the
`Conversation` each call names).
`goalCommand` answers a person's mistake (a second goal, pausing a completed one) with an error notice, but every entry
rejects when a port or the wiring fails, and the host reports that rejection as an error instead of a notice:

| Entry                                          | The host calls it when                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `goalCommand(ports, thread, text, requestKey)` | A person sends `/goal …`. The answer is a `GoalNotice` to show, never a model turn. The host routes `/goal` here instead of submitting it: Durable has no input hook, and a `/goal` submitted as plain input reaches the model as text.                                                                                                                               |
| `userStop(ports, thread, requestKey)`          | A person stops the conversation's turn: the stop button, and every other stop that does not come through `/goal`. The stop is recorded before the turn stops and names the turn begun before its record, so a repeated request stops that turn and never a later one; a goal's `aborted` judgement and the suppression of waking results read only that record, so a stop that bypasses this entry lets the goal start another round and the results wake the agent as usual. |
| `stopSubagent(ports, child, requestKey)`       | A person stops a subagent, or a child thread's `interrupt()` arrives. The entry reads the child and commits on its parent. A background child stops alone (`'stopped-child'`); a running foreground child is part of its parent's turn, which stops (`'stopped-turn'`, D27); `'not-running'` when there was nothing to stop, a finished child included.               |
| `permissionModeChanged(ports, thread)`         | The host switched the conversation's permission mode; an armed goal that plan mode held still may go on, and only then is the idle driver woken.                                                                                                                                                                                                                      |

The host must also:

- Persist approval outcomes across restarts and identify a call by its `CallRef`; `Approvals.outcomes(thread, [])`
  lists every call it knows on that thread, and the package asks for a conversation and for each of its children. The
  `ToolCallFact` the gate passes carries the call key as its `callId`, because the gate sees no provider call id.
- Show an ask the way `ApprovalRequest.presentation` says, and compute `withinAllowedRoots` per permission mode and tool
  category in `Approvals.facts`.
- Answer `Models.current(thread)` with both keys non-empty and whether the conversation's model can call tools.
- Keep `Settings` cheap to read: every decision reads each setting once.
- Answer `Settings.attendance`, `Settings.permissionMode` and `Approvals.facts` for a child's thread as for its root
  conversation: the gate asks with the thread of the conversation that made the call, a child's included, and a
  child's calls follow the root conversation's interaction state, permission mode and agent tool policy. Return
  `'unavailable'` only when nobody can respond: it blocks every call that needs approval.
- Recompute the views with the exported `subagentViews` when a child's approval state changes (an ask starts or is
  answered): the package emits views only after its own steps, and no step of the parent sees that change.

Beyond [What the adapters provide](#what-the-adapters-provide), each adapter must:

- Call `install` at open and after every restart, and forward every child thread's `interrupt()` to
  `entries.stopSubagent`.
- Set `Delegation.status` to `delegationStatus(record)` from the latest record of each child run, one run being one
  `DelegationId`.
- Ask `onCompacting` before every compaction, under the key the `CompactionRequest.key` TSDoc names for the harness, and
  pass the verdict through; meter a compaction during a run as one of its requests. Never call `Summarizer` itself.
- Pass each tool call's turn abort signal to `GateHandlers.before` as `call.signal`, and withdraw a steer that misses
  its run, or whose tool call aborts first (`Helpers.message` called with `run` answers `withdrawn`; the key
  `subagent-steer:<callKey>:<run>` is spent), instead of carrying it into the next run or holding the stopped turn.
- Contain no product constants or stop-code literals; they come from the package's results.

Not in the package yet: `enter_plan_mode` and `exit_plan_mode` (PR-3d); the shutdown record `onClose` writes for
running children (PR-3a); worktree isolation and its `Workspaces` port (PR-4). A known gap: while a failed run's
leftover inputs hold a conversation, the idle driver leaves results it would deliver quietly and a compaction's
status for later and exits, and a person's later turn does not wake it; they wait for its next wake (a child's run
ending, a compaction or a reopen).

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
- `context-filter`: Durable skips this, because it never consults `ContextFilter` (H10, a declared difference: a round
  withdrawn after it started, or cut by a restart before its admission, stays visible to later model requests there).

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
  of a run is one, and so is the end of every job; `clock.now` is not.
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

Pass explicit test file paths under `packages/agent-behavior/tests/`; `tests/orchestration/` runs the orchestration on
the fake, and `tests/orchestration/fixtures/` runs each scenario fixture three ways (to the end, crashed at every await
point, replayed into the core). `typecheck` resolves `@cherrystudio/agent-runtime`
types from its built `dist/`, hence the first command, and runs `tsc` twice: once over the package and once over
`src/core/` alone with no Node or DOM types, which keeps core free of the environment. The lint guards for imports,
layers and key minting have their own test:
`pnpm test:scripts scripts/__tests__/agent-behavior-boundary.test.ts`.
