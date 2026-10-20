# Agent Note: Harness-neutral agent behavior package

Status: proposed

English | [中文](2026-10-18-agent-behavior-package.zh.md)

## Problem

Cherry's product rules for agents are written as Pi coding-agent extensions. Subagents (foreground and background runs, continuation, delivery, slots, model selection), goals (state, rounds, stops, budget, progress, verifier, `/goal`), `AskUserQuestion`, `todo_write`, offload, recall and summary acceptance live in [agent-runtime-pi](../../../../packages/agent-runtime-pi/README.md); the approval rule layer lives in the [host Pi integration](../../../../src/main/ai/runtime/pi/README.md); plan mode exists only as a design.

Cherry is adding Pi Durable through [agent-runtime-pi-durable](../../../../packages/agent-runtime-pi-durable/README.md), which a different maintainer owns. Durable is a separate execution system with different primitives: hooks cannot commit, tool-bound handles expire with the call, input to a busy conversation is rejected, steered or queued by a submission policy, and a child's owner is fixed when it is created. Porting each rule into a second set of extensions would leave two copies that drift, and neither copy could be tested without its harness.

The rules need one home that is testable without any harness and survives harness churn: Durable's API is experimental, and whether coding-agent stays a production backend is still open. In scope are subagents (including planned worktree isolation), goals, approval decisions and plan mode, `AskUserQuestion` and `todo_write`, offload, recall and summary acceptance. Out of scope are storage and session files, the AI SDK model bridge, the Durable adapter itself, chat, sandboxing, the common access semantics (contracts, `ThreadFeed`, Lane projection), UI and billing.

## Proposal

### One package: a pure rule core and its orchestration

Add `@cherrystudio/agent-behavior` at `packages/agent-behavior/`, created by PR-1. The full API is documented in that package's README; this note records the decisions behind it.

- The rule core maps facts to decisions. It is synchronous and has no I/O, clock, random ids or environment access, so it can run inside a Durable commit between the reads and the writes.
- Orchestration runs the tools, jobs, tool gate and host entry points against two port families. Harness-side ports are implemented by adapters: the coding-agent adapter in `agent-runtime-pi`, the Durable adapter in `agent-runtime-pi-durable`, and an in-memory fake that ships with this package as a permanent second implementation. Host-side ports are implemented by Cherry.

```text
Cherry host -> adapters (coding-agent, Durable, fake) -> agent-behavior -> agent-runtime (types only)
inside agent-behavior: orchestration -> core, orchestration -> ports; core imports neither
```

- Dependencies point one way. The package imports no adapter, Pi or host code, and the adapters do not depend on each other ([harness boundaries](2026-10-17-agent-harness-boundaries.md) AC1).
- Each adapter implements both the common `AgentRuntime` access and our harness ports in its own package. It translates native facts and executes the decided operations; it never re-implements a rule.
- The relation to `@cherrystudio/agent-runtime` is one-directional. We import types only: the opaque ids, `JsonValue` and `ContentPart`. `MessageItem` and `ToolCallItem` are an observation protocol with completeness and without usage, so the history model is ours. We export `delegationStatus()` and `delegationTrigger()`; adapters call them when projecting `Delegation`, replacing the `unknown` status both adapters publish today. One child run maps to one `DelegationId`.
- Model-side child operations stay off `ThreadHandle.submit`, which still rejects managed children. If the `spawn` and `cancel` controls proposed in [subagent control](2026-10-18-agent-runtime-subagent-control.md) land, adapters route them to our entry points and the semantics stay here.

### Facts, decisions and records

- Facts: the core reads one conversation's ordered, full-lineage history (including entries folded by compaction or hidden by reset), its live facts (idle, queued user input, run end, reopened), its children's facts (running, awaiting approval, per-run usage summed from the child's own entries) and the keys already present. Per-call inputs are gathered from host ports before the decision: clock, settings snapshot, approval outcomes, model candidates, verifier verdict, and the current goal round's call window.
- Decisions: every decision is a JSON value, so it can be memoized, and every decision returns one shape, a step: transactional operations (append a record, append a quiet input, spawn a child, ensure a job), keyed effects run after the commit (start, retract or stop a turn; message or stop a child; emit an observation), and a result for the model or the tool's details.
- Records are history entries. Goal snapshots, subagent run records, plan state and user-stop records are custom-kind entries in the same ordered sequence as messages; round markers and notifications are custom-kind input entries. The existing `cherry.*` kinds keep their names, so current sessions need no migration; `cherry.plan` and `cherry.turn-stop` are new. Adapters may mirror records into documents in the same commit for UI and hooks, but the entries are authoritative.
- A child's usage is summed from its own entries; tool results and notifications no longer carry it except as a display cache. A user stop is a record written by the host entry before the harness stops the turn, so suppression after a stop survives a restart.

### One step: a pure decision in a transaction, then keyed effects

- `Ledger.transact(thread, decide)` reads all facts, calls the core synchronously and applies its operations in one commit; if `decide` throws, nothing is written. Whatever must be atomic with the decision is an operation, not an effect: slot reservation, the user-stop record, the suppression check with its quiet append, and the re-check after a round is submitted.
- Effects run in order after the commit, with no decision between them. A later decision is a new step that rereads the facts; orchestration keeps no module or instance state and no timers, and waits only through ports.
- Operations whose key is already present are dropped. Effects are deduplicated by the harness request id, by memo, or by being idempotent. A rerun tool call, a rerun job phase or a full history replay therefore performs each side effect at most once.

### Keys derived from facts

- Nothing mints ids. Every id and key is a pure function of facts: the call key (Durable's tool task id, or `<sessionId>:<toolCallId>` on coding-agent), `goal:call:<callKey>` or `goal:cmd:<requestKey>` for a host command, `subagent-spawn:<callKey>`, `subagent-msg:<child>:<n>`, `subagent-report:<runKey>` (the spawn or message key, never a child id), `idle-driver:<thread>:g<generation>`, a notification key that digests the sorted `child:run` list, and the memo names `cherry.approval:`, `cherry.ask:`, `cherry.verdict:` and `cherry.summary:`. Child conversation ids come from the harness at creation and are recorded in the same commit.
- Round keys are `goal-round:<goalId>:r<round>:v<revision>:a<armSeq>`, where `armSeq` counts how often the goal has been armed, read from records. Disarming on reopen and then `/goal resume` does not bump the revision; without `armSeq`, the resumed round would be deduplicated into the pre-reopen submission that was already retracted.
- On Durable, an input rejected while the conversation is busy leaves no record, so its key can be reused; a withdrawn or unanswered submission is recorded, so reserving again needs a new key. The key components above guarantee that.

### The idle driver

- Each conversation has at most one `idle-driver` job, abandoned on restart; its key carries a generation counted from the driver's exit records, and the driver's final decision writes that exit record in the same commit, so an ensure that races an exiting driver creates the next job instead of being deduplicated away. Each background run has one `subagent-report` job, resumed on restart, which messages the child, awaits its answer and records the run's end.
- On each wake the driver waits until the conversation is idle and makes one decision, `decideAtIdle`, in this order: queued user input waits; an exceeded budget first stops the goal's still-running background children; pending results are appended quietly while a user stop's suppression lasts, or start one notification turn ahead of any goal round; the goal then waits (no active armed goal, plan mode, background children running), starts a round, or stops; with nothing left, the job exits.
- On Durable, rounds and notifications are submitted with `whenBusy: 'reject'`, so user input wins admission. A step after submission retracts a round whose goal changed, or stops it if it already started. The job is a background task on Durable; a foreground driver would wait for itself in `waitForIdle`.

### Ports

| Family | Ports | Implemented by |
| --- | --- | --- |
| Harness, outbound | `Ledger`, `Turns`, `Helpers`, `Waits`, `Memory`, `Clock` | coding-agent adapter, Durable adapter, fake |
| Harness, inbound | `Tools`, `ToolGate`, `ContextFilter`, `RequestMeter`, `Lifecycle`, `Jobs` | coding-agent adapter, Durable adapter, fake |
| Host | `Approvals`, `Questions`, `Models`, `Verifier`, `OutputStore`, `Summarizer`, `Observation`, `Settings`; `Workspaces` arrives with the worktree PR | Cherry host; scripted in the fake |

Port instances are bound to one tool call, job or host entry and expire with it, matching Durable's call-bound handles. On Durable, `ContextFilter` is not installed, and the request cap is enforced by the model bridge, whose owner receives that requirement.

### Ownership

- MyPrototypeWhat owns this package: the rule core, ports, orchestration, the fake and the contract cases. The rule contracts now in the `agent-runtime-pi` README move into this package's README, and the common-layer notes link to it instead of defining goal or subagent semantics.
- Adapters implement the harness-side ports; the coding-agent adapter becomes wiring only. The Durable adapter's owner implements the harness-side ports against the contract cases and a requirements list handed over once PR-1 is stable: full-lineage reads before writes in one commit, records as display-only entries, input with request ids and busy rejection, the two child ownership shapes, resumed report jobs and abandoned driver jobs, prefixed memo, stop-before-resume (the harness restores every interrupted run and the package's `onOpen` handler ends the ones the rules name, through `abortTask` and `abortSubmission` without enabling scheduling), an inbound compaction method that hands the compaction key to the package, task-id call keys, and `Delegation.status` from `delegationStatus()`.
- Adapters never re-implement rules. Product constants and stop codes reach them only through this package's outputs.

### Owner decisions

The owner settled these on 2026-10-18:

- Foreground or background is fixed at spawn by `background`, default foreground; neither harness offers move-to-background, so coding-agent drops `moveToBackground` and the host's `backgroundSubagent` entry. A foreground child is owned by the calling tool, which waits for its answer; aborting the parent turn stops foreground children only. `stop_subagent`, the user's stop control and budget stops apply to both, foreground children take no background slot, and a child's `interrupt()` is a user stop for a background child and a parent-turn stop for a foreground child.
- Continuing a finished child always runs in the background and returns the id to use afterwards. Coding-agent keeps the id. On Durable a finished background child continues in place, while a finished foreground child is forked into a new background child with a new id; later calls on the old id are forwarded to it and answered with the new id.
- Reopening never resumes an interrupted background child or an armed goal's round: the harness restores every interrupted run, and the package's `onOpen` handler stops them before any resumed work; adapters never judge which runs belong to a goal.
- Background child usage counts toward the goal budget as it occurs, not once at delivery; one wrap-up round remains.
- Goal rounds are driven by the per-conversation idle driver with custom-kind round entries, not by `onYield`.
- Rules run in tools and jobs, not in hooks; hooks only ask the core whether to block a call, rewrite its arguments or replace its result.
- Rule contracts live in this package's README, and the common-layer notes link to it.
- The package is `@cherrystudio/agent-behavior`. It avoids the `agent-runtime-*` prefix because it does not implement `AgentRuntime`.

Decisions recorded while implementing PR-1 (2026-10-19 to 2026-10-20):

- `Waits.untilDone(thread, key)` replaces the run-end wait: the driver waits on the key it submitted, so leftover inputs cannot make it spin.
- A steer merges only into the running run it names; it is withdrawn when that run ends first or when the tool call that sent it aborts, and it never starts a run. Steer keys are per run.
- A fork always creates a new conversation; placeholder results are filled only for a fork subagent's own unanswered calls, and unanswered calls get the interrupted result before any run starts.
- The gate's `before` receives an abort signal; an aborted ask leaves no memo.
- `onCompacting` is asked before every compaction; a declined compaction compacts nothing; an adapter refuses compactions that would bypass it.
- One idle driver per conversation, confirmed by the owner; a forked child does not drive itself.
- Dead fields found by the YAGNI audit were removed (`callWindow`, `GateFacts.lineage`, `LiveFacts.reopened`, the tool-result `blocked` flag, `turn-stop.by`).

### Capabilities limited by the harness

These rows are the only intended behavioral differences between harnesses. Items marked inferred follow from Durable source and are not covered by its examples or tests.

| # | Designed capability | Why Durable 1.3.0 cannot | Degradation | Upstream | Lifted by an upgrade |
| --- | --- | --- | --- | --- | --- |
| 1 | Move a running foreground child to the background | A conversation's owner and a task's background flag are immutable. | Neither harness offers it; the mode is fixed at spawn. Parking every child under a background anchor and emulating foreground would buy it; we chose not to emulate. | None found | Yes, if upstream can re-parent a conversation under a background boundary |
| 2 | Keep the id when continuing a finished foreground child | The tool task owns the child; a new run inside it falls under the parent's abort and idle traversal and holds the parent's run open. | Fork a new background child with a new id and forward the old id; coding-agent keeps the id. | None found | Yes, as row 1 |
| 3 | Recognise goal continuation rounds in history (`onYield`) | `onYield` returns only `{ continue: UserInput }`, written as a plain `pi.user` entry. | Idle-driver job with custom-kind round entries, at the cost of one more background task and commit. | Could request `entry: { kind, data }` on `continue` | Yes |
| 4 | Read history and write records in hooks | `HookApi` offers ids, models, memo and document reads; hooks cannot commit. | Rules run in tools and jobs; hooks only ask the core whether to block. | Could request read-only entry scanning in `HookApi` | Yes, and row 5 with it |
| 5 | Repeated-call window that stays continuous across restart | As row 4: `beforeTool` cannot see earlier calls. | Build the window from host-level `Conversation.entries()` through a late-bound Harness reference (inferred); without it, an in-process window resets on restart and lets at most two more identical calls through. | As row 4 | Yes |
| 6 | Never wake automatically after a user stop | Admission cannot check a document first, `admitSubmission` is not exported, and Durable's own background example opens a turn for a report that arrives after Esc. | Results during suppression are appended quietly, checked and appended in one commit (inferred). If the user stops after the driver decided to wake but before admission, that one notification still opens a turn. | Could request conditional submission or an admission predicate | Yes |
| 7 | From a task, write a model-visible entry without starting a turn while busy | A task's handle accepts only input; while busy, only the Harness writes model context. | Raw append only when idle with an empty inbox (inferred); while busy, wait for idle without waking. | Could request `write` on `ConversationHandle` | Yes |
| 8 | Per-run request cap for children | No primitive; an error thrown in `beforeRequest` is skipped. | The model bridge counts per session and fails request 201 with a non-retryable `quota exceeded` error; the adapter reports `limit_reached`. | Could request a request budget or a refusing `beforeRequest` | Yes |
| 9 | Interaction identity, expiry and late answers; no repeated question after a crash | No interaction primitive; `beforeTool` waits before intent and reruns after a crash. | The host persists approval outcomes, and a `cherry.approval:` memo records each answer; a crash before the user answers asks again. | Could request an interaction primitive | Partly: the memo stops re-asking answered questions; a crash while waiting still asks again |
| 10 | Intercept `/goal` inside the harness | No input hook; the Durable spec routes its own `/plan` through the host too. | The host routes `/goal` to the goal command entry; a `/goal` submitted as plain input reaches the model as text. | Not needed; upstream design | Not applicable |
| 11 | Hide not-yet-admitted goal rounds from the model (`ContextFilter`) | No context hook; a Durable submission enters history only once it is admitted, so an unadmitted round never reaches the model | `ContextFilter` is not installed on Durable (declared difference); the coding-agent adapter installs it | Not needed | Not applicable |

## Alternatives considered

- Write the rules directly as Durable extensions: rejected because it keeps a second copy beside the coding-agent extensions, ties the rules to an experimental API, and leaves them testable only through a harness; Durable hooks also cannot read entries or commit.
- A thin pure-policy package without orchestration (the `agent-policy` candidate): rejected by the owner as too thin, because each adapter would re-implement the orchestration (transactions, keys, jobs, waits) and recreate per-harness copies. The name also reads as approval and permission policy in Cherry.
- Put the rules in the common access package: rejected because `@cherrystudio/agent-runtime` holds harness-neutral access contracts, opaque ids and `ThreadFeed` without an execution loop or product entities; goal and subagent semantics there would make the access layer define product behavior.
- Background-only subagents: adopted earlier on 2026-10-18 and reversed the same day. Every delegation would become asynchronous, losing the call that returns a child's answer as its tool result; native foreground ownership also stops children with the parent turn without orchestration emulating foreground or relying on an untested guard-task combination on Durable.
- `onYield` for goal rounds: rejected because a continuation is written as a plain user entry, so rounds cannot be recognised in history for admission, deduplication or turn origin.

## Acceptance criteria

AC1–AC5 are the five review guardrails, AC6 summarises the boundary guards, and AC7–AC11 are test outcomes.

- AC1 — Every port and method in `src/ports/` is named as a verb and object without harness nouns (hook, commit, session, task, extension), and each port's TSDoc documents its coding-agent, Durable and fake implementations plus its keys and waits. (verification: unit — package owner, port-naming test over `src/ports/`: no harness nouns in identifiers, and every port's TSDoc carries the three implementation sections)
- AC2 — Every port method has a call site in `src/orchestration/`; harness ports carry no capability flags (`supports*`, `capabilities`) and no optional methods, while a model's `supportsTools` stays a domain fact on the host port; core and orchestration never branch on a harness name; a new capability adds its port methods in the same PR. (verification: unit — package owner, port-usage check and review)
- AC3 — Every orchestration write is a `Ledger.transact` operation and every keyed effect takes its key from `core/keys.ts`, while the unkeyed effects (stop a turn, stop a child, emit) are idempotent; `src/orchestration/` has no module-level `let`, no instance fields mutated outside constructors, no `new Promise` and no timers, and waits only through `Waits`, `Helpers.awaitAnswer` and host ports. (verification: unit — package owner, lint rules and orchestration tests on the fake)
- AC4 — The package imports only types from `@cherrystudio/agent-runtime` (ids, `JsonValue`, `ContentPart`); both adapters set `Delegation.status` from `delegationStatus()`; common-layer READMEs and notes link to this package instead of defining goal or subagent semantics. (verification: unit — package owner for imports, adapter owners for `Delegation.status`; docs gate for links)
- AC5 — Every port method is covered by at least one contract case, the fake and both adapters pass the same cases, and CI fails a PR that changes the port method set without matching fake changes and contract cases. (verification: unit — package owner for the fake and coverage check; coding-agent and Durable adapter owners in their packages)
- AC6 — The package depends only on `@cherrystudio/agent-runtime` in `package.json` and its lockfile closure; `src/**` cannot import Pi, Node, Electron, host, logger or AI SDK modules; `src/core/**` imports no other layer, touches no clock, randomness, crypto, process, timers, fetch or `globalThis`, and contains no `async`, `await`, `Promise` or `yield`; the only export is `"."`; port keys are branded values from `core/keys.ts`; adapters contain no product constants or stop-code literals. (verification: unit — package owner, lint and package checks; adapter owners in review)
- AC7 — Core decisions are deterministic, never mutate inputs, still succeed when `Date.now`, `Math.random` and `crypto.randomUUID` throw, survive a JSON round trip, and contain only ids traceable to their inputs. (verification: unit — package owner, core purity tests)
- AC8 — Each scenario fixture holds the replay invariants I1–I5 when run to completion, crashed at every await point, and replayed into the core. (verification: unit — package owner, fixtures on the fake)
- AC9 — The same scripted scenario on the fake, coding-agent and Durable yields the same fact and decision sequences, and each adapter's declared-difference table cites only rows of the harness-limited table, a port the ports section declares as not installed on that harness, or coding-agent's own restart limitation. (verification: unit — package owner with the coding-agent and Durable adapter owners, contract cases)
- AC10 — Foreground or background is fixed at spawn on every harness, aborting the parent turn stops only foreground children, and continuing a finished child runs in the background and returns the id to use next, with calls on a forwarded old id answered with the new id. (verification: unit — contract cases on the fake and both adapters)
- AC11 — Reopening a conversation with an armed goal or interrupted background children starts no turn and resumes no child, and background child usage counts toward an active goal's budget as it occurs. (verification: unit — package owner, reopen and budget fixtures on the fake; adapter owners, contract cases)

### Verification plan

- Core tests use plain data and no harness, and each case states the bug it catches.
- The fake keeps a durable part (entries and records, submissions by request id, memo, job table) and a volatile part (in-flight promises, in-process windows). It has a scripted model, scripted host ports and deterministic scheduling without real timers; `crashAt(n)` drops volatile state at the n-th await point, rerunning resumed jobs from the start and dropping abandoned ones. It matches Durable's shape: call-bound ports, reads before writes, busy rejection without a record, and the same key returning the original submission.
- Ten fixtures, each naming the bug it catches: background spawn and delivery; two children ending together; results after a user stop; three rounds without progress; the same call five times; approval denied during a goal; reopening an armed goal; a resumed round that must not be deduplicated (`armSeq`); concurrent spawns at the slot cap; plan mode entry, blocking and rejected exits.
- The replay invariants: I1 accumulated state equals a full recompute; I2 the same facts give the same decisions across restart; I3 an incremental cache equals a full recompute; I4 every side effect has an idempotency key and happens at most once; I5 a crash and recovery at any await point leaves a durable log equivalent to the uncrashed run, apart from declared rows.
- Contract cases in `src/contract/cases.ts` use plain throws and no test framework. They run on the fake in this package; on coding-agent in `packages/agent-runtime-pi/tests/`, where restart cases are skipped as declared because Pi does not resume runs; and on Durable in `packages/agent-runtime-pi-durable/tests/` with a faux provider and memory or Node SQLite storage, simulating crashes by closing and reopening.

### PR split

| PR | Content | Verification |
| --- | --- | --- |
| PR-1 `feat(agent-behavior): add rule core, ports and fake harness` | Package skeleton and guards; ports with TSDoc; pure rules moved from `agent-runtime-pi` and the host approval extension, already reshaped as above; orchestration; fake and contract cases. `agent-runtime-pi` is untouched. | Core purity tests; fixtures on the fake in all three modes |
| PR-2 `refactor(agent-runtime-pi): implement agent ports on coding-agent` | Adapter implements the harness ports and its extensions become wiring; moved rules and `moveToBackground` with the host `backgroundSubagent` entry are removed; README rule sections move to the package README. | Existing `agent-runtime-pi` tests, with implementation-pinning tests deleted or rewritten; contract cases on coding-agent |
| PR-3a to PR-3e | User-stop records and quiet delivery while suppressed; goal accounting and plan-mode wait; host approval obligations moved into the core; plan mode, after the permission-mode PR on `main`; offload and summarizer replay. | Matching fixtures and contract cases |
| PR-4 `feat(agent-behavior): isolate subagents in worktrees` | Optional worktree isolation for non-fork children, with the `Workspaces` port. | New contract cases |

The stack builds on `feature/agent-runtime-background-subagent`, or on `main` if that stack merges first. The Durable adapter's work stacks on PR-1 and proceeds alongside PR-2; host integration starts once both adapters pass the contract cases, and each later contract case binds the Durable adapter too, which may skip only rows of the harness-limited table.

## Risks

- Pi Durable is experimental: its README says the API changes without notice between releases, 1.2.0 had several breaking changes, and in 1.3.0 the spec's code blocks already lag `src`. The adapter follows `src` and type declarations, the contract cases are the compatibility check, and the owner of version pinning is not yet decided.
- One stack now carries two abstractions, the common access layer and our ports, both implemented by each adapter. They stay one-directional (types in, `delegationStatus()` out); drift starts if the access layer defines goal or subagent semantics, or an adapter reaches a child around our entry points.
- Four Durable behaviors the design relies on are inferred from source and not yet covered by upstream examples or tests: raw-appending display-only records in a tool or job commit behaves like a passive entry; raw-appending a model-visible entry when idle with an empty inbox, in the same commit as the check; a durable `waiting … allSettled` wait as an alternative to in-memory `waitForTask`; and building the gate's call window from `Conversation.entries()` through a late-bound Harness reference. Each needs a contract case on the Durable adapter; only the call window has a declared fallback (row 5).
- Accepted costs: the residual wake window after a user stop (row 6), a call window that resets on restart without the late-bound reference (row 5), a repeated question after a crash during an approval (row 9), budget stops that arrive earlier than today's delivery-time accounting, one more background task and commit for the driver, and a package name that overlaps the boundaries note's use of "behavior" for harness duties.
- Whether coding-agent remains a production backend is an open team question. The design holds either way: rules and orchestration depend only on ports, and the fake keeps harness neutrality from depending on coding-agent.

## Related notes

- The [goal note](../feature/2026-10-11-agent-runtime-goal.md) and [background subagent note](../feature/2026-10-14-agent-runtime-background-subagent.md) keep owning the Pi-specific behavior until the PR-3 series updates them. This note reverses two of their decisions: moving a running foreground child to the background, and counting background usage once at delivery.
- [Harness boundaries](2026-10-17-agent-harness-boundaries.md), the [runtime contract](2026-10-17-agent-runtime-contract.md) and [subagent control](2026-10-18-agent-runtime-subagent-control.md) own the common access layer this package builds on.
- The current rule contracts are in the [agent-runtime-pi README](../../../../packages/agent-runtime-pi/README.md); the package itself, `packages/agent-behavior/`, is created by PR-1.
