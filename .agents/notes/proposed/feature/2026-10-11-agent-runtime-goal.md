# Agent Note: Pi autonomous goals and host integration

Status: proposed

English | [中文](2026-10-11-agent-runtime-goal.zh.md)

## Problem

A long-running objective needs more than another model prompt: it needs a persistent identity, explicit permission to continue, accounting across requests and child work, and a reliable way to stop. Cherry supports models with different instruction-following abilities. Runtime decisions must bound autonomous continuation even when a model ignores a request to stop or repeatedly reports the same work.

The Pi package implements this capability through a native extension. The desktop still uses its existing `PiRuntimeConnection`, so package behavior does not establish desktop delivery. This note keeps the goal decision and its remaining host obligations together; it remains proposed until the complete integration and acceptance criteria are verified. It does not declare a lifecycle transition or approval for a new implementation.

## Proposal

### Ownership and scope

[`createGoalExtension`](../../../../packages/agent-runtime-pi/src/goalExtension.ts) owns autonomous continuation, goal tools, and stop decisions within a native Pi session. [`goalState.ts`](../../../../packages/agent-runtime-pi/src/goalState.ts) owns the state transitions and branch-derived accounting. Pi owns model execution, tool execution, compaction, and native session persistence. Cherry supplies model transport, approval events, defaults, an optional completion verifier, and presentation through `GoalPort` and the existing session builder.

The goal extension is an optional Pi capability, not a new loop in the [common runtime contract](../architecture/2026-10-17-agent-runtime-contract.md). The [harness boundaries](../architecture/2026-10-17-agent-harness-boundaries.md) and [background subagent note](2026-10-14-agent-runtime-background-subagent.md) govern execution ownership and child-result delivery. This feature does not introduce a second transcript format, a goal-specific database, or an independent host scheduler.

### Persistent state and recovery

- The active branch's latest native `cherry.goal` entry is the current goal. Changes append complete snapshots; clearing appends a tombstone without deleting history. The four phases are `active`, `paused`, `blocked`, and `complete`. Stop details belong in `lastStop`, not extra phases.
- Mutations check the goal id and revision. Creating starts at revision 1; edits, stops, and round admission advance it. Repeated pause, resume of an already active and armed goal, and repeated blocked reports on an already blocked goal do not append another state change. Stale mutations return the current view instead of applying the change.
- `armed` records whether the goal may drive the session. It is present in snapshots, but reopening always disarms a restored goal and records that change without advancing the revision. The phase may remain `active`; restoration alone never restarts work. Re-arming an active goal also preserves its revision.
- A `cherry.goal-round` custom message has its own random reservation id, goal id, revision, round number, and kind (`work`, `hint`, or `wrap-up`). A snapshot's `admittedRound` proves which reservation actually ran. Reusing the same round number after a crash does not admit an older reservation.
- A round prompt repeats the complete objective as data inside `untrusted_objective`, names its round and cap, and asks for concrete evidence before completion. Compaction does not remove the native goal state, and the next prompt does not depend on an earlier objective message surviving.

### Admission, continuation, and stopping

Creating or resuming from an idle `/goal` command starts the first round. During a running turn, the command or model tool only arms the goal for its next decision boundary. Normal continuation is decided at `agent_before_settle`; a round counts only when its message is admitted at `message_end` or `turn_start`, not when the extension proposes continuation. Existing boundary entries from earlier extensions are preserved.

Before admission, the extension rechecks identity, revision, activation, the next round number, and capacity. A command that edits, pauses, clears, or lowers a limit while another settle handler waits can invalidate the reservation. The stale round is withdrawn before its model request and is not counted. `agent_settled` may start a replacement for this internal withdrawal, or stop under the new limits. A concurrent user `abort()` still wins and pauses the goal.

A later extension can veto continuation. A surviving unadmitted reservation becomes `blocked / continuation_rejected`; an actual abort takes precedence. Unadmitted round messages remain in native history but are filtered from subsequent model requests and the completion verifier. The compaction summarizer still sees them, which remains a limitation.

The decision boundary handles aborted or failed execution, pending stop reasons, activation and autonomy, and queued user input before selecting another round. A queued user message goes first without cancelling an armed goal; that human turn is not a goal round. `confirm-each-round` pauses after an admitted round, and one resume permits one more. Background result delivery and goal continuation cannot both initiate work at the same boundary: a notification's turn settles before the goal decides again. At a continuation boundary, running background children make the armed goal wait without changing its phase or writing a `waiting_subagents` stop.

Abort, pause, and clear have different meanings. A runtime abort pauses an active, armed goal with `aborted`; a host request signal reaches the same outcome through the settle path. `/goal pause` records `paused_by_user`, while `/goal clear` writes a tombstone. These commands abort a busy turn only when the goal was active and armed; they leave an unrelated human turn on a disarmed goal alone. The host must use `AgentRuntimeSession.prompt`, `compact`, and `abort` so notification delivery and user stops share the package's admission boundary.

### Usage and progress come from the native branch

[`goalUsage` and `goalProgress`](../../../../packages/agent-runtime-pi/src/goalState.ts) derive their answers from native entries every time a budget, status, completion check, or snapshot needs them. `tokensUsed`, `costUsed`, and `progressRounds` in a snapshot record the values at that moment for display; they are never the source of subsequent decisions. This keeps live and reopened sessions consistent and avoids a second ledger.

- A parent request counts when its input ended in an admitted goal round while the goal was active. State written while the response is in flight does not remove that request. The request that invokes a stopping tool counts; later requests, including the summary after completion, do not.
- Parent token usage includes input, output, cache reads, and cache writes. Cost comes from each entry's recorded price, never from repricing history with the current model. Unpriced models provide no useful USD limit and need a token budget.
- A tool result's reported usage belongs to the request that issued the call. A foreground child that returns after pause still counts. This is goal budgeting, not another charge: Cherry already accounts for the underlying model calls.
- A background run launched, moved to the background, or continued by a counted request belongs to that goal. Its usage counts once when a notification or `stop_subagent` result delivers it, deduplicated by child session and run. Delivery after pause, block, or disarm still counts; a later run begun by a human turn does not inherit an older goal's ownership.
- A standalone notification turn is neither a human turn nor a goal round. Its parent requests count while the goal is active and armed. A notification carried with a human message or a goal round belongs to that turn instead. A standalone notification ends the preceding round's progress interval.
- A round progresses if a successful tool result does more than read or bookkeep, or its last non-truncated text reply differs after whitespace normalization. `NON_PROGRESS_TOOLS` defines the exclusion set, including reads, recall, todo updates, and user questions. Tool work earlier in the same batch is visible to completion checks. An aborted round contributes no progress; a human message resets the no-progress streak, and re-arming also resets the text comparison. Child internal tool calls do not appear as parent actions; a successful `subagent` call itself can count.

### Limits, human intervention, and completion

The host supplies `maxGoalRounds`, `maxGoalRoundsCeiling`, `blockedAfter`, and the live `autonomy()` callback; the package has no built-in values for them. The proposed host baseline, also used by the test helper, is 100 rounds, a ceiling of 1000, three blocked-report rounds, `auto`, and no token or USD budget. A round is one autonomous continuation after the model settles, not one model request; its tool loop can contain many requests. Fixed package thresholds are two no-progress rounds before a hint, three before stopping, the third identical tool call before blocking it, and the fifth before termination. Tool-call comparison uses the tool name and canonicalized arguments, independent of object key order. Objectives are trimmed to 1–4000 characters.

| Condition | Behavior |
| --- | --- |
| Round cap | The last allowed round is a wrap-up. Afterward the goal blocks with `round_limit`. Lowering the cap to the already running round leaves no extra wrap-up. |
| Token or USD budget | Crossing either budget permits one wrap-up if the round cap leaves room, then blocks with `budget_exhausted`. This is a continuation limit, not a strict per-request spending ceiling. |
| No progress | Two unproductive rounds produce a hint; three stop with `no_progress`. Repeated identical calls are blocked from the third attempt; the fifth terminates that tool loop and requests a stop. Truncation alone is not a stop, but truncated text is not progress. |
| Human intervention in a goal round | A denied approval requests `approval_denied`; unavailable approval requests `awaiting_approval`; a declined question requests `needs_user_input`. Pending approval waits without opening rounds. An unavailable question does not itself stop the goal. Ordinary human-turn approvals do not trigger these goal stops. |
| Model request error | An active, armed goal blocks with `provider_error` and the native error text after the model layer's retries. The goal layer does not retry. |
| Completion or model-reported blocker | Verified completion becomes `complete`; an accepted blocker becomes `blocked / model_blocked`. These outcomes do not rely on silently interpreting ordinary model prose. |

Raising a limit reopens a limit-blocked goal only when both its round cap and budget have capacity; it clears the old stop and wrap-up flag but still needs resume to arm. Raising only one exhausted limit cannot buy another wrap-up. Resume without capacity is refused. Completion is terminal for pause, resume, and further completion or blocked reports; editing does not make a completed goal runnable, and new work needs a new goal.

`GoalVerifier` receives the objective, claim, full post-compaction native conversation after replay rules, current model, and cancellation signal. `met` completes, `not_met` rejects the claim with its reason, and `impossible` blocks. Exceptions do not pass completion. The package sets no verifier timeout; the host must honor cancellation and provide its own limit. The goal revision is checked again after verification so an intervening edit, pause, or clear cannot be overwritten. Without a verifier, non-empty evidence and at least one progress round are required; this is a fallback check, not independent proof of correctness.

A model-reported blocker needs a reason. In a human turn it is accepted immediately; autonomous reports need `blockedAfter` consecutive rounds, with at most one count per round. Human input, resume, or an edit resets that count. The implementation counts consecutive reports; it does not prove that their reason strings describe the same condition.

The goal changes no approval policy. In manual mode every tool that needs approval stops for a person, which is the user's choice; the host only explains this when a goal starts (see the host obligations below). An approval in a goal round decides only that tool call: the model receives its result and the run goes on to its settle, where a denial blocks the goal with `approval_denied` and an approval nobody can give blocks it with `awaiting_approval`. Neither is a model-reported blocker, so neither counts toward `blockedAfter`. A pending approval holds the goal without opening rounds or spending tokens. The same applies to background children: while a goal runs, their approvals still wait for the user, and the goal neither denies nor allows them on the user's behalf; see the [background subagent note](2026-10-14-agent-runtime-background-subagent.md).

When the current goal's observed budget is exhausted, its owned running background children are stopped with `stoppedBy: 'budget'` at turn end and before settle decisions, even if the goal has paused or blocked or is yielding to user input. An active, armed goal with an exhausted budget also refuses new background launches. A pause, abort, or other stop within budget leaves background children running. The package connects this behavior through its internal `SubagentGoalLink`; there is no `hasRunningSubagents` host port.

### Tools, commands, and host obligations

The sequential, model-only tools remain `get_goal`, `create_goal`, and `update_goal`, with the established goal view and `activation: 'armed' | 'disarmed'`. Their exact schemas and error codes live in the source. The model may create, edit, pause, or resume only in a human turn; notification turns do not count as human input. Creating requires no unfinished goal. Optional empty strings and zero are treated as omitted, negative limits fail validation, and an edit without fields is rejected.

`/goal [<objective> | edit <objective> | pause | resume | clear | rounds <n> | budget <tokens|$usd>]` is handled as a native command without a model request of its own. Control words match case-insensitively only when they occupy the whole input; numeric subcommands require exactly one numeric argument. With no goal, `edit <text>` is an objective, while bare `edit` reports the missing goal. Feedback uses native `cherry.goal-notice` state entries, outside model context.

Models without tool calling receive no goal tools or command; an existing active goal is marked `unsupported_model`. A subagent must not control a parent goal inherited by a fork: goal tools reject with `in_subagent`, automatic continuation is disabled, and the child does not subscribe to the parent's approval port. Session configuration must preserve this boundary rather than assuming the parent's extensions are inherited automatically.

The remaining desktop integration must:

- Project native goal snapshots, round messages, and notices into goal status, round headers, and distinct stop-turn, pause-goal, and clear-goal controls. A withdrawn reservation appears as an aborted runtime turn, not a completed round or a user-requested stop; the UI must preserve that distinction.
- Require the existing approval system to confirm model-originated `create_goal`, supply the current session's approval events, and explain interactive approval requirements when the user starts an autonomous goal. Events from other sessions must not stop the parent goal; session identity is preferable to call-id-only matching.
- Decide and enforce the permission-mode policy, including not starting autonomous rounds in plan mode. The package currently does not know Cherry's permission mode or offer a plan-mode admission hook; the host behavior remains unimplemented.
- Record each new `lastStop.at` once for stop reason, rounds, usage, and elapsed-time analysis. Treat later user correction after completion as evidence for evaluating completion quality, not as automatic proof that every later request invalidated the goal.

External-event wakeups, cron scheduling, a `waiting` goal phase, a fresh context per round, and an AI approver are outside this proposal. Selecting an independent evaluator model is a future host implementation of the existing verifier port, not another package loop.

## Alternatives considered

- Prompt-only repetition: insufficient because stopping, budgets, and user intervention would depend on the model obeying instructions. Native runtime boundaries provide enforceable continuation decisions.
- Host-side scheduling and a duplicated transcript or counter store: not selected because replay, accounting, and cancellation would gain competing owners. Native branch entries supply the durable facts.
- Count a round when proposed or identify it only by goal, revision, and round number: rejected because later extension vetoes, stale reservations, and crashes can leave an unexecuted prompt that otherwise counts as work. Admission records use a unique reservation id.
- Accumulate usage or progress in memory, or restore from snapshot totals: rejected because mid-request stops, late child results, and same-batch completion can make live and restored decisions disagree. Recomputing from the branch accepts a scanning cost to retain one source of truth.
- Unlimited continuation or one model request per round: not selected. A configurable high cap bounds useful but unfinished work, while progress checks and optional budgets address loops and cost. The displayed round count is retained for predictability; whether it encourages premature completion needs host evidence.
- Block the goal merely because children are still running: replaced by waiting within the active goal, then letting native result delivery settle before continuation. Ordinary goal pause does not cancel independent background work.
- Trust every completion claim, or require an evaluator model before any use: neither is selected. The port supports independent verification, while the fallback requires evidence and observed progress and clearly retains weaker assurance.

## Acceptance criteria

These are complete delivery outcomes. Source tests listed below are evidence locations, not claims that this documentation migration executed or passed them.

- AC1 — A native session reopens with the same goal identity, phase, limits, and branch-derived usage, but disarmed; explicit resume is required, and compaction does not lose the objective. (verification: unit — Pi adapter maintainers, `gatewayGoalRebuild.test.ts` and `goalState.test.ts`)
- AC2 — Only an admitted reservation advances the round count; vetoed, withdrawn, and pre-start-crash reservations do not leak into later model or verifier input or consume a round. (verification: unit — Pi adapter maintainers, `gatewayGoal.test.ts`, `gatewayGoalStops.test.ts`, and `gatewayGoalRebuild.test.ts`)
- AC3 — User input, abort, pause, clear, each-round confirmation, and model errors prevent an unwanted next round, including when they race a later settle handler or verifier. (verification: unit — Pi adapter maintainers, `gatewayGoal.test.ts` and `gatewayGoalStops.test.ts`)
- AC4 — Caps and budgets allow only their documented wrap-up; stale mutations and resume without capacity are refused, while raising all exhausted limits permits explicit continuation. (verification: unit — Pi adapter maintainers, `goalState.test.ts` and `gatewayGoalStops.test.ts`)
- AC5 — Live and reopened accounting agrees for in-flight parent requests, late foreground results, notification turns, continued background runs, and overlapping stop receipts, without charging human work or billing underlying requests twice. (verification: unit — Pi adapter and model-binding maintainers, `gatewayGoalStops.test.ts` and `gatewayGoalSubagents.test.ts`)
- AC6 — Runtime progress checks stop repetitive work, use earlier successful work in a completion batch, and exclude aborted rounds; verifier rejection, exception, or a concurrent goal edit cannot silently complete the goal. (verification: unit — Pi adapter maintainers, `gatewayGoalStops.test.ts`)
- AC7 — Background results and goal continuation do not start competing turns; a budget overrun stops only the current goal's owned running children, while a pause within budget leaves them running. (verification: unit — Pi adapter maintainers, `gatewayGoalSubagents.test.ts`)
- AC8 — Unsupported models and child sessions cannot start autonomous parent-goal work, and another session's approval event cannot stop that goal. (verification: unit — Pi adapter maintainers, `gatewayGoalRebuild.test.ts` and `gatewayGoalSubagents.test.ts`)
- AC9 — The desktop uses the package's session entry points, confirms model-created goals, enforces its permission-mode policy, renders distinct stop controls and withdrawn rounds, and restores a goal without restarting it. (verification: Electron — Cherry host integration owner)
- AC10 — Host stop telemetry is deduplicated, reflects snapshot timing and goal-budget attribution, and does not report scripted-model tests as live-provider or desktop acceptance. (verification: unit and Electron — Cherry host integration owner)

## Current implementation and evidence

The [package README](../../../../packages/agent-runtime-pi/README.md) describes the implemented package API. The [desktop Pi README](../../../../src/main/ai/runtime/pi/README.md) explicitly identifies the existing production connection and the separate package integration. Rebuilding the native session on every host turn is not a goal requirement, and doing so while background children run would violate their ownership contract.

| Evidence location | Contract it exercises |
| --- | --- |
| [`goalState.test.ts`](../../../../packages/agent-runtime-pi/tests/goalState.test.ts) | State transitions, limits, branch interpretation, progress classification, and prompt/view shapes. |
| [`gatewayGoal.test.ts`](../../../../src/main/ai/runtime/pi/gatewayGoal.test.ts) | Tools, command grammar, admission, queued input, and autonomy. |
| [`gatewayGoalStops.test.ts`](../../../../src/main/ai/runtime/pi/gatewayGoalStops.test.ts) | Limits, stale reservations, interruption, approvals, completion, progress, and request-time accounting. |
| [`gatewayGoalRebuild.test.ts`](../../../../src/main/ai/runtime/pi/gatewayGoalRebuild.test.ts) | Disarmed restoration, reservation identity across crashes, compaction, unsupported models, and fork isolation. |
| [`gatewayGoalSubagents.test.ts`](../../../../src/main/ai/runtime/pi/gatewayGoalSubagents.test.ts) | Background waiting, notification ordering, budget ownership, stop deduplication, continuation, and approval isolation. |

The [goal test helper](../../../../src/main/ai/runtime/pi/gatewayGoalSupport.ts) drives native Pi through real AI SDK streaming with scripted models and compares restored goal views with live checkpoints. These tests do not establish live-provider behavior, desktop wiring, UI acceptance, or a shipped permission policy. No test result or approval is inferred from the presence of these files.

## Risks

- Progress is a heuristic: changed text or a successful action does not prove that the objective advanced. The fallback completion check is weaker than independent verification, and blocker reasons are not semantically compared.
- Budgets are observed at boundaries and permit a wrap-up. One round may contain many requests, and background usage is visible only when its result is delivered; this feature cannot promise an exact token or USD ceiling for in-flight work.
- Native branch scans grow with history. Snapshot totals deliberately cannot replace them without proving identical behavior for late results and recovery.
- Extension ordering and Pi event timing affect admission. Unadmitted prompts still reaching the compaction summarizer can influence a later summary despite request filtering.
- Host UI, approval wiring, plan-mode policy, telemetry, and live-provider verification remain open. Session-less approval events can collide by tool-call id, and cancellation-unaware verifiers can delay a result despite the signal contract.
