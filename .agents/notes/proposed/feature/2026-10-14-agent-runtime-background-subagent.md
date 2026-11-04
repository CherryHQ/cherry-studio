# Agent Note: Pi background subagents and continuation

Status: proposed

English | [中文](2026-10-14-agent-runtime-background-subagent.zh.md)

## Problem

A foreground subagent returns its report through a blocking tool call. Independent work also needs to outlive the parent's turn, report back without polling, and accept further instructions. Treating that work as an ordinary tool result loses its lifecycle once the call returns; treating every child reply as a parent input creates duplicate delivery, unexpected wake-ups, and incorrect goal accounting.

This note owns Pi-specific execution and delivery behavior. The package implementation exists on this stack, but desktop integration and complete acceptance remain unfinished, so the note remains proposed. Migration of the design does not establish new approval or verification. The [subagent control proposal](../architecture/2026-10-18-agent-runtime-subagent-control.md) owns optional public controls and cross-harness composition; [harness boundaries](../architecture/2026-10-17-agent-harness-boundaries.md) and the [runtime contract](../architecture/2026-10-17-agent-runtime-contract.md) own the common abstraction.

## Proposal

### Ownership and scope

Keep the subagent extension in `packages/agent-runtime-pi`. Cherry has chosen its own implementation to avoid coupling its UI to community-plugin TUI and terminal interaction assumptions. This does not imply that every community plugin requires a TUI; reusable execution APIs can be evaluated separately. Pi remains the owner of native sessions, agent loops, tools, branches, and storage. The extension owns its child runs, control routing, and result delivery. The host supplies models, approvals, storage associations, and presentation; `AgentSessionDeliveryService` is not this controller.

The model-facing surface is three `model-only` tools: `subagent({ description, prompt, fork?, background?, model? })`, `message_subagent({ id, message })`, and `stop_subagent({ id })`. Foreground is the default. A child session has a random UUID independent of provider tool-call IDs or the parent's ID; each continuation increments its `run`. Creation's `parentToolCallId` and a continuation's `continuedBy` identify their triggering calls, not the child's lifetime.

The current common Pi adapter observes child contexts and routes interruption through their parent owner, but rejects child `submit` with `managed-child`. Native `message_subagent` is available; exposing it through the common contract remains the separate control proposal. Neither a discovery event nor a streaming output handle grants permission to bypass the extension and prompt the child directly.

This scope excludes model-facing wait, list, and intermediate-output tools; child-to-child orchestration; nested subagents; named child types; idle timeouts; automatic restart of interrupted work; a stop-all UI; and filesystem conflict isolation. Status messages replace model polling. UI streaming remains possible through native observations. Worktree or sandbox isolation needs its own design.

### Creation, models, and limits

Children run in process from the parent's session options, including tools, prompts, compaction, offload, recall, and settings. `SubagentPort.configure` supplies the child's own extensions, event listener, live-session callback, and optional model/runtime. Parent `extensionFactories` and `onEvent` are not inherited; requirements attached to the selected borrowed `ModelRuntime` still apply. `onSessionCreated` runs before the first request and can read the already-created native branch. A configuration or callback failure fails that call; a built child is disposed if its callback fails.

A fresh child starts with empty context and no subagent-management tools. A fork uses the native assistant entry containing the current call, supplies identical placeholder results for every tool call in that entry, and leaves the parent branch unchanged. The host must supply the same tool definitions and order for a fork; the fork keeps the parent's model/runtime and retains the subagent tools to preserve the prefix, but their execution fails inside a child. The current child prompt and `AskUserQuestion` extension prohibit asking the user directly; approvals still flow through the host. This is Pi integration policy, not a universal harness invariant.

Without a named model, the host may select its default child model; otherwise the parent's model is used. `model` is offered only when `findModels` exists and should be supplied only when the user or agent instructions named one. The host searches enabled models with tool support. The package selects exactly one candidate marked `exact`; zero exact matches fail with up to five similar names, and multiple exact matches fail with a request to clarify the provider/model. It never silently chooses among providers. A named model cannot accompany `fork: true`.

The actual native `provider/id` key is stored in `cherry.subagent-origin`. Continuation requires that model again, with its borrowed runtime when necessary. The host may omit the model only when the recorded key equals the parent's current model. A fresh fork ignores another model/runtime returned by `configure`.

Each run permits at most 200 model requests, including its turns and native or host-provided compaction summaries; request 201 is refused before dispatch. Child cache warming is disabled because it would bypass the request counter. Reply usage is accumulated from native events so compaction cannot erase replies already counted. That reply sum is not a second billing ledger: Cherry's model call path already accounts requests.

At most `maxBackground` children run in the background at once, default 20, including pending launch reservations and children awaiting approval. Failed creation releases its reservation. Foreground work does not consume a background slot. Moving an existing foreground run to the background is allowed even at the cap and counts against later launches; it does not start another run.

### Messaging and native storage

| Child state | `message_subagent` behavior |
| --- | --- |
| Running or awaiting approval | Queue the message; Pi receives it after the current tool batch. Once the child starts settling, hold arrivals for the next segment in the same session. |
| Being stopped or continued | Wait for the recorded stop or the other continuation, then apply the resulting state's rule. Concurrent messages do not open competing continuations. |
| Finished, including interrupted or aborted | Load the native manager, configure the same child/model, increment `run`, and continue in the background. |
| Stopped by the user | Refuse continuation, even if a later model or budget stop also targeted the winding-down run. |
| Unknown ID, missing loader/storage, wrong native ID, or absent origin | Refuse; never create a replacement context or address another parent's child. |

Membership comes from the parent's native tool results and state entries, not an ID prefix. `load(id)` returns a native `SessionManager`; its session ID and origin must be present before continuation. The child keeps its original session ID. An interrupted or aborted run gets a recovery instruction to inspect existing work first. Unanswered calls in the last replayable assistant reply receive an interrupted/unknown-result tool response; errored or aborted replies that Pi excludes from replay do not gain orphan results. Reopening history does not automatically repeat unfinished tools.

Accepted messages are drained across the child's settle boundary before it finishes. A later explicit stop or shutdown can discard messages already queued for that run; acceptance is not a guarantee of execution after cancellation. A continuation starts with `cherry.subagent-message`, so `before_agent_start` sees `messageType: 'custom'`; handlers intended only for human prompts must check the message type.

File-backed parents create native child files in the same session directory with a native parent-session link; in-memory parents create in-memory children. A fork stores its prefix in the child's native branch. Pi writes these files and the origin before extension startup. `session-append` observes later entries; it is not a host transcript persistence protocol. The host records product/native session and file associations and must define deletion of associated child storage with the parent.

| Native entry | Owner and purpose |
| --- | --- |
| `cherry.subagent-origin` | Child state: creating call, description, fork, and actual model key; not model input. |
| `cherry.subagent-state` | Parent state: background run start, completion, and accepted user stop; includes result and usage when known, not model input. |
| `cherry.subagent-notification` | Parent custom message: completed/interrupted runs, full child IDs, outcomes, and structured per-run usage. |
| `cherry.subagent-status` | Parent custom message after compaction: running/waiting children and results not delivered yet. |
| `cherry.subagent-message` | Child custom message carrying additional instructions. |

Restoration derives the current child state from its latest record, but recovers undelivered results for every `(sessionId, run)`, including earlier runs of a subsequently continued child. A committed notification is the delivery record; no separate delivered flag or snapshot is authoritative. Runs already reported through `stop_subagent` are marked separately as `modelStopped` and do not notify again. A foreground-only child can be found from its original tool result, while continuation obtains its actual model from the child's origin.

### Delivery and lifecycle

Completed background results arrive in finish order. While the parent runs, a completed `agent_before_settle` merges queued results into one notification and continues that run, but queued user messages take priority. Quiet results alone do not extend a settling run. When the parent is idle, a result that can wake it starts an autonomous notification run only after host prompt/compaction holds have cleared. Every new run's `before_agent_start` takes all queued results with it, including runs started by commands such as `/goal resume`; this behavior also applies to custom messages in Pi 1.3.0.

Host calls must use `AgentRuntimeSession.prompt`, `compact`, and `abort`. The wrappers prevent notification starts during prompt preparation, commands/input handlers, or manual compaction. A prompt or compaction requested during settle waits for that settle and any run Pi starts there, then resolves or rejects with its actual operation. Native idle state alone cannot protect those preparation windows. Direct native calls bypass this coordination.

| Action | Effect and report |
| --- | --- |
| Foreground completion | The blocked call returns the final report, child ID, outcome, and reply usage; failure returns the reason and last partial output. |
| `backgroundSubagent(id)` | Return the foreground call immediately; detach parent-turn cancellation and keep the same session, request, and run. Completion later notifies. Unknown, finished, or already-background children return false. |
| Model `stop_subagent` | Stop the run, return partial output and run usage, and suppress later notification. Continuation remains possible unless the user also stopped that run. |
| User `stopSubagent(id)` | Stop a running background child and persist user intent immediately, before winding down. Report quietly with the next run's start or another waking notification; refuse later continuation. |
| User abort of the parent turn | Stop foreground children, leave background children running, and suppress automatic parent wake-up until another run starts. |
| Parent disposal | Abort and dispose live children. Recover cut-off runs as interrupted after reopen; preserve results that had already completed before shutdown began. |

User stop takes precedence over overlapping model/budget stops. `modelStopped` separately records whether the model already received that run's result, avoiding duplicate notification without weakening the user's stop. The common Pi child handle follows this owner: interrupting a background child is the user's non-continuable stop; interrupting a foreground child aborts its parent's turn. These semantics must not be advertised as exact cancellation of an arbitrary historical delegation.

After parent user abort, background results continue accumulating but cannot immediately steal a new turn. The next run, including a user command's run, ends suppression and takes the queue. A goal withdrawing a stale reserved round marks its abort as internal and does not suppress delivery. An explicit wrapper `abort()` still wins if it lands in that same withdrawal; an aborted host request also counts as a user stop.

Reopening never wakes the parent solely for recovered work. A last `running` snapshot becomes `interrupted`, or `stopped/user` if the user's stop was already persisted. Recovered results and interruptions are quiet until the next run or a waking result includes them. Shutdown writes no terminal snapshots for runs it cuts off; a run already finished while child disposal completes still records its real result. Temporary `awaiting_approval` state is not persisted.

Notifications are native custom messages rendered to the model as user-role text, explicitly labeled automatic; the host must not render them as human message bubbles. Their structured details support rendering and budgets without entering model text. Reports over the offload threshold use the host store; without one, reports over 20,000 characters retain head and tail. Offload failure follows the existing offload policy and does not claim a readable saved file. Compaction appends status without starting a turn, preserving knowledge of ongoing work and avoiding duplicate launches. A notification committed at settle counts as delivered even if the run is then aborted; it remains in history for the next request.

### Approvals and goal integration

The host installs approval handling through `configure` and identifies each request by the child's real session and tool-call ID. Pending approval marks the child `awaiting_approval`; resolution or call completion restores `running`. Include `ToolApprovalEvent.sessionId` because call IDs can collide across sessions. Parent approval UI must remain available while the parent is idle, route feedback to the requesting child, and retain a background child's request when the parent turn ends. Denial affects that tool call; unattended execution uses the host's unavailable/deny path. Approval of delegation is not approval of every child tool.

Background children's approvals go to the user, the approach other products settled on after trying alternatives (see Alternatives considered). The request shows in the parent session, labelled with the asking child, while that child waits; each request belongs to one child and is confirmed on its own, with no batch approval. A denial refuses only that call, and the child continues with the reason. The parent must see `awaiting_approval`: otherwise it cannot tell a child stuck on an approval from one still working, and an unattended run stays stuck overnight. While a goal runs, a child's approval still waits for the user; the goal never denies or allows it automatically.

The [goal note](2026-10-11-agent-runtime-goal.md) owns the goal state machine. With no higher-priority stop condition, an active, armed goal waits while background work runs, without becoming blocked or writing a stop snapshot; progress can still be persisted. Delivery runs before the goal's settle decision, and a notification already selected for that settle prevents adding a competing goal-round prompt.

A standalone notification turn is neither a human turn nor a goal round. It ends the previous round's progress boundary, adds no goal round, and cannot authorize human-only goal edits. A notification attached to the start of a human or goal turn belongs to that turn instead. Parent requests in a standalone notification turn count toward an active, armed goal's budget.

Usage and ownership are reconstructed from the native branch, not a mutable accumulator. A background run belongs to the goal when the request that launched, moved, or continued it counted for that goal; a later human continuation does not inherit the earlier run's owner. Attribute the run's reported usage once by `(sessionId, run)`, whether delivered by notification or overlapping stop results, even if the goal is paused, disarmed, or stopped at delivery time. Reopen and `/goal resume` see the same budget. Host billing must not charge this reported usage again.

An active, armed goal with exhausted budget refuses new background launches and continuations. Independently, budget checks at every native `turn_end` and the start of every settle stop the goal's still-running background work, regardless of phase or which settle branch follows. Pausing after each round or yielding to queued user input cannot skip that check. Pause, abort, and other stops within budget leave background work running. Child approvals do not stop the parent's goal; the approval listener filters by owning session and currently executing calls.

### Remaining host acceptance

Desktop integration must retain the parent while background children run; implement model selection and native storage lookup; show child streaming, model, cost, and approval source; connect single-child stop and foreground-to-background controls; and render notification runs as autonomous `background-work`. The proposed child model setting and UI actions are host work, not already-shipped package behavior. Optional automatic movement to the background when a user sends another message is a host policy, not a package default.

## Alternatives considered

- Replace the extension with a community plugin now: not selected because TUI/presentation and control integration need separate evaluation; native Pi execution and storage remain reused.
- Add wait, polling, and output-reading tools: not selected for this scope. Push results and post-compaction status avoid busy waiting and duplicate work, while the host can independently observe streams.
- Tie background work to the parent's tool signal, or restart it when moved: rejected because parent turn completion and user interruption must not cancel background work or repeat its side effects.
- Inject results during the current tool batch, or bypass wrappers because native state says idle: rejected because it changes ordering and races prompt preparation, compaction, and settle callbacks.
- Store a host-owned transcript or persist only each child's latest result: rejected because native entries carry the replay context and earlier undelivered runs must survive continuation and restart.
- Treat every stop alike or let later stops replace user intent: rejected because model stops permit continuation, user stops forbid it, and shutdown interruption is not user refusal.
- Keep goal costs only in memory, count by child ID alone, or check budget only when continuing a round: rejected because restart, multiple runs, duplicate stop results, pauses, and queued user input would misattribute costs or leave work running past budget.
- Reconstruct fork history from a pointer into the parent: deferred. It could reduce duplication but would make continued children depend on a parent branch that may have been edited or deleted.
- Auto-deny background children's approvals, let children never ask or run in a forced automatic mode, restrict them to tools that need no confirmation, or treat approving the delegation as approving every tool the child runs: rejected because Claude Code, Codex, Goose, and Gemini CLI each abandoned one of the first four, and Cline adopted the last only because concurrent children shared one terminal prompt, which confirming each request separately avoids.

The original 2026-10-13/14 comparison retained concrete failure evidence: [Codex #15723](https://github.com/openai/codex/issues/15723) distinguishes receiving a result from waking its idle owner; [Codex #34268](https://github.com/openai/codex/issues/34268) records full-history fork storage amplification; [VS Code #337339](https://github.com/microsoft/vscode/issues/337339) records child approvals orphaned by parent cancellation; and [OpenCode #45417](https://github.com/anomalyco/opencode/issues/45417) records omitted child costs. These support the wake policy, storage tradeoff, approval lifetime, and visible cost attribution above, not claims about today's upstream implementations.

The historical [Claude Code 2.1.178 changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21178) records fixes for messages arriving as a child finishes and background moves restarting work; [2.1.191](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21191) and [2.1.211](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21211) address resurrection after user stop and model retention; [2.1.280](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21280) addresses late messages, unread reports lost to compaction, and unsolicited restart turns; [2.1.296](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21296) distinguishes shutdown interruption from user rejection. [Codex #13850](https://github.com/openai/codex/pull/13850) and [#41183](https://github.com/openai/codex/pull/41183) preserve the other considered choices: non-final interruption and child usage attributed to a root goal. The current design turns these failure classes into local invariants and regression criteria rather than copying another product's control surface.

The same comparison traced how child approvals changed. [Claude Code 2.1.186](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21186) replaced auto-denial of background agents' tools with a prompt in the main session that names the asking agent, where Esc denies only that tool. [Codex #11464](https://github.com/openai/codex/pull/11464) (v0.100) made children never ask; [#12767](https://github.com/openai/codex/pull/12767) (v0.105) restored the parent's approval policy with a list of threads awaiting approval, and [#12995](https://github.com/openai/codex/pull/12995) (v0.110) added approval of a child's request from another thread. [Goose #12802](https://github.com/aaif-goose/goose/pull/12802) replaced a forced Auto mode with approvals forwarded to the parent turn. Gemini CLI went from an [allowlist of tools that need no confirmation](https://github.com/google-gemini/gemini-cli/blob/v0.10.0/packages/core/src/agents/executor.ts#L698-L728) to [confirmations bubbled to the main view](https://github.com/google-gemini/gemini-cli/blob/51617c1bcbcb038291125b092501b4342f4e7f77/packages/core/src/agents/local-executor.ts#L170-L216). [Cline 3.0.63](https://github.com/cline/cline/blob/ed469c753a0d7a0d41f906cf3fc75a983cd766ac/apps/cli/CHANGELOG.md#L99) moved the other way, no longer asking about a configured subagent's tools once its delegation was approved, because concurrent children shared one terminal prompt where a single `y` could approve several operations; Cherry instead confirms each child's request separately. [Claude Code #99887](https://github.com/anthropics/claude-code/issues/99887) records a parent that could not see a child stuck on an approval, which left an unattended run stalled overnight.

## Acceptance criteria

These outcomes describe the complete feature; existing source tests are evidence locations, not tests rerun or acceptance claimed by this migration.

- AC1 — Fresh and forked children have independent native identities; forks preserve the correct prefix/tool order without changing the parent or enabling nested management. (verification: unit — Pi adapter owner, `subagent.test.ts` and `subagentFork.test.ts`)
- AC2 — Named-model resolution rejects zero or multiple exact matches, forks keep the parent model/runtime, and continuation retains the recorded model and binding. (verification: unit — Pi adapter owner, `subagentModel.test.ts` and `subagentBinding.test.ts`)
- AC3 — The 201st child model request, including compaction requests, is refused before dispatch; background reservations enforce the configured cap and release on failure. (verification: unit — Pi adapter owner, `subagentStops.test.ts` and `subagentBackground.test.ts`)
- AC4 — Foreground-to-background movement returns the parent call without replaying the child request and detaches later parent-turn cancellation. (verification: unit — Pi adapter owner, `subagentMove.test.ts`)
- AC5 — Messages accepted at a child's settle boundary reach the same session; concurrent continuation opens one run, and missing or foreign native storage cannot create a replacement. (verification: unit — Pi adapter owner, `subagentMessage.test.ts` and `subagentContinue.test.ts`)
- AC6 — Result delivery preserves user priority, finish order, compaction/prompt holds, and command-start delivery; no notification starts during user-abort suppression. (verification: unit — Pi adapter owner, `subagentDelivery.integration.test.ts` and `subagentDelivery.test.ts`)
- AC7 — User-stop intent survives overlapping stops and shutdown during winding down; model-stopped runs report once; public child interruption reaches the correct native owner. (verification: unit — Pi adapter owner, `subagentStop.test.ts`)
- AC8 — Reopening reports every undelivered run once without automatically executing it, preserves results completed during shutdown, and recovers interrupted context with unknown-result markers. (verification: unit — Pi adapter owner, `subagentRebuild.test.ts` and `subagentContinue.test.ts`)
- AC9 — Child approval state is observable, session-qualified events cannot affect another session, and child denial cannot stop the parent's goal. (verification: unit — Pi adapter owner, `subagentApproval.test.ts` and `goalSubagents.test.ts`)
- AC10 — Goals wait without blocking; standalone notifications end prior round progress without adding goal rounds, while notifications accompanying a round retain that round's identity. (verification: unit — goal owner, `goalSubagents.test.ts` and `goalState.test.ts`)
- AC11 — Goal usage and run ownership survive restart, count each delivery once, and enforce budget stops despite pause or queued input without stopping unrelated later runs. (verification: unit — goal owner, `goalSubagents.test.ts`)
- AC12 — The desktop shows independent child progress, approval source, model and usage; stop and move controls preserve the package semantics, and autonomous notifications are not human bubbles. (verification: Electron — Cherry runtime integration owner)
- AC13 — Persistent desktop sessions reopen the same native child IDs/files, load without event replay, and remove associated storage according to the product's deletion policy. (verification: Electron — Cherry storage integration owner)

## Risks

Each fork copies native history, increasing storage; shared prompt text does not guarantee cache reuse when the host partitions caches by child session ID. Busy parents receive results only at settle. Holding wrappers are required for host entrypoints, and the package cannot prevent direct native calls from bypassing them.

Shutdown-cut-off work cannot distinguish normal app exit from a crash. Its restored notification can have zero usage when no finished-run record exists; per-run reply totals and delayed result delivery do not establish a hard live spending cap. Already queued messages can be lost to a later stop. An accepted stop is not terminal completion, and a committed notification is not proof that a model consumed it before an abort.

Approval events lacking session identity are ambiguous when call IDs collide. Shared working directories have no write-conflict isolation. Approvals that wait for the user are an accepted cost: during a goal, a child's pending approval holds that child, and the goal waiting for it, until someone answers, and unattended runs cannot use tools that need approval. The current child question prohibition, lack of stop-all UI, and disabled cache warming are accepted limitations of this integration. Maintaining our extension carries ongoing Pi compatibility work.

## Current evidence

The [package README](../../../../packages/agent-runtime-pi/README.md) describes current entrypoints. [Subagent control](../../../../packages/agent-runtime-pi/src/subagent.ts), [native child storage](../../../../packages/agent-runtime-pi/src/subagentSession.ts), [run execution](../../../../packages/agent-runtime-pi/src/subagentRun.ts), [registry/recovery](../../../../packages/agent-runtime-pi/src/subagentRegistry.ts), and [delivery](../../../../packages/agent-runtime-pi/src/subagentDelivery.ts) implement the Pi-specific behavior above. [Goal state](../../../../packages/agent-runtime-pi/src/goalState.ts) and [goal execution](../../../../packages/agent-runtime-pi/src/goalExtension.ts) own accounting and budget transitions.

The named `gateway*.test.ts` files live under `src/main/ai/runtime/pi/`; package tests live under `packages/agent-runtime-pi/tests/`. They exercise native Pi and Cherry's model binding, with test providers and controlled interleavings. The [integration README](../../../../src/main/ai/runtime/pi/README.md) explicitly states that the desktop connection still uses its existing path. Source coverage, live-provider acceptance, Electron behavior, and packaged loading are separate evidence levels; see [harness evidence](../testing/2026-10-17-agent-harness-evidence.md). This documentation migration did not rerun those execution tests.

[Agent behavior package](../architecture/2026-10-18-agent-behavior-package.md) partly supersedes this note: it drops foreground-to-background movement (AC4) and counts background usage as it occurs instead of once at delivery (AC11). The rest stays current until the behavior package's follow-up PRs update it.
