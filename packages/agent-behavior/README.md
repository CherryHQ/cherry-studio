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
| `core/`     | Facts, host facts, entry codecs, `Step` / `TxOp` / `Effect`, key derivation, `sha256Hex` | Synchronous and pure: imports no other layer, has no `async`, `await`, `Promise` or `yield`, and touches no clock, randomness, process, `fetch` or timers. |
| `ports/`    | The harness ports (`harness.ts`) and the host ports (`host.ts`)                          | Interfaces and TSDoc only; imports core types only.                                                                                                   |
| `fake/`     | `createFakeHarness`, `createScriptedHost`                                                | The in-memory second implementation of the ports.                                                                                                     |
| `contract/` | `harnessContract` and the `ContractHarness` an adapter implements                        | The cases every harness must pass.                                                                                                                    |

`orchestration/` (the tools, jobs, tool gate and host entry points that run the rules over the ports) and the rule
functions are added by later PRs. Until then, goal and subagent semantics stay in the
[agent-runtime-pi README](../agent-runtime-pi/README.md) and move here when the adapters adopt this package.

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
| H5  | `Waits`         | `untilIdle`, `untilRunEnd`         | Wait until a conversation has no run, or until its current run ends; waiting keeps no state.              |
| H6  | `Memory`        | `remember`                         | Remember an answer from a person or a model so a restart never asks again.                                |
| H7  | `Clock`         | `now`                              | Read the time in whole milliseconds; nothing mints ids, they derive from keys.                            |
| H8  | `Tools`         | `register`                         | Put the package's model-only tools on the harness.                                                        |
| H9  | `ToolGate`      | `register`                         | Before a call runs, allow it, block it or change its arguments; after it ran, replace its result.         |
| H10 | `ContextFilter` | `register`                         | Leave unadmitted round entries out of the next model request.                                             |
| H11 | `RequestMeter`  | `register`                         | Meter every model request with its conversation's lineage; refuse a child's next one once its run reached the cap. |
| H12 | `Lifecycle`     | `register`                         | Let the package settle a conversation when it opens, after it is compacted and when it closes.            |

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
a running child (a steer) joins the run in progress. Runs are numbered from 1 in that order, `Helpers.message` reports
the run a message was accepted into, and `ChildFacts.runUsage[i]` sums the usage of the child's own entries of run
`i + 1`. `Helpers.awaitAnswer` is bound to the message key: when the harness carries a message that missed its run's
last boundary into the next run, the answer is that next run's end.

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
| P3  | `Models`      | `find`, `supportsTools`, `keysFor`                                                              | Find models by the name a person said; tell whether a conversation's model can call tools; name that model and the model a child gets by default. |
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

In each format the one free-form id comes first and only colon-free numbers or a hash follow, so ids containing `:`
stay apart.

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
| `subagentReport(runKey)`                                   | `subagent-report:<runKey>`                                             | A run's `subagent-report` job. `runKey` is the new run's spawn key or the continuation's message key, because a spawn's commit has no child id yet.  |
| `approvalMemo(call)`, `askMemo(call)`, `verdictMemo(call)` | `cherry.approval:<call>`, `cherry.ask:<call>`, `cherry.verdict:<call>` | `Memory` names for an approval, an AskUserQuestion answer and a verifier verdict.                                                                     |
| `summaryMemo(compactionKey)`                               | `cherry.summary:<compactionKey>`                                       | The `Memory` name of a compaction summary.                                                                                                            |

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
| `turn-stop`             | `cherry.turn-stop` (`turnStop`)                         | record | `{ by, cause, at, key? }`                      | `by` is `'user'`, `at` a number; `cause`, when present, is user, goal-command or reopen                                                                               |
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
other than `true` as `false`, and reads a `turn-stop` stored without `cause` (written before it existed) as
`cause: 'user'`. The adapter maps the other history entries (user, assistant, tool result, compaction) to
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
carries the text of the person's message. Every tool call (a `ToolCallFact` in an assistant entry's `toolCalls`) and
every `tool-result` carries `callKey`: the adapter computes it with `callKeyOf` from the same id as the gate's
`GateCall.key` (Durable: the tool task id; coding-agent: `<sessionId>:<toolCallId>`), so a call, its result and the
host's approval outcomes for it share one key; the case `a tool call and its result read back under the gate's call
key` asserts it. Two mappings are easy to miss:

- Durable records a call the gate blocked as a tool result whose text is `Tool call blocked: <reason>`. Project it as a
  `tool-result` with `isError: true` and `blocked: '<reason>'`; the gate cases assert `blocked`.
- coding-agent stores markers as `custom_message` entries and records as `custom` entries. Pass `customType` as
  `RawEntry.kind`; for a `custom_message`, `details` as `RawEntry.data` and the text of `content` as `RawEntry.text`;
  for a `custom` entry, its `data` as `RawEntry.data`.

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
| `compact(thread)`         | Compact `thread` now (a compaction entry appears), then call `onCompacted`.                                                                                                                                             |
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
- `now`: start of the manual clock, default 0.
- `scripts(thread, lineage)`: seeds the script of each conversation as it is created, children created inside jobs
  included.

Beyond `ContractHarness` it offers:

- `ports`: the current `HarnessPorts`, with outbound ports bound to a scope that never ends; replaced on every restart.
- `advanceClock(ms)`: the clock moves only when the test advances it.
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
`options.settings` (a `HostSettingsSnapshot`) is required; `models` (default none), `supportsTools` (default true),
`modelKeys` (the `Models.keysFor` answer; default `scripted/parent-model` and `scripted/child-model`) and
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
