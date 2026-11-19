# Agent Note: Approval answers read from history

Status: implemented

English | [中文](2026-11-18-behavior-approval-history.zh.md)

## Problem

Long Pi Durable sessions with background subagents slowed down a little more every round. In a 10-round replay of a reported session (four subagents a round, local mock model), round time rose from 12.0 s to 18.6 s, and in rounds 9 and 10, 23.8 s of the 34.6 s the main process was busy ran under agent-behavior's `outcomesFor`.

Before every decision, and after every step that touched a subagent, the package asked the host for approval outcomes: once for the conversation and once for each child it ever had. Each `Approvals.outcomes` call ran `listApprovalMessages`, a synchronous `json_each` scan over the whole session's messages. The event loop therefore blocked for one scan per thread per decision, and the cost grew with both the history and the number of children.

The read existed because a person's answer had two homes: the approval card in the session's messages, and the call's blocked result in the conversation's own history. The rules read the copy the host had to search for, and they read the children's calls only to show a child as `awaiting_approval`.

## Decision

The rules read a person's answer only from the conversation's own history. A denied or unanswerable approval already ends as the call's blocked result:

- `Approvals` keeps `facts` and `ask`. `outcomes`, `ApprovalOutcome` and `CallInputs.approvals` are removed, and `gatherInputs` reads only the clock and settings.
- Every adapter projects the reason the gate blocked a call with as `blocked` on its `tool-result` entry. Durable reads it from the result's structured `blocked` diagnostic; coding-agent and the fake read it from the `Tool call blocked: ` prefix they wrote themselves.
- A goal round stops with `approval_denied` when one of its results was blocked with `deniedReason(...)`, and with `awaiting_approval` when one was blocked with `NOBODY_TO_APPROVE`.
- A parent reads nothing about its children's calls. `SubagentView.status` is `running` or `finished`, and the model-facing subagent lists say `running` for every live child.

The approval card in the session's messages remains the record people see and answer; the behavior rules no longer read it. The harness contract case for the tool gate requires `blocked` on every adapter, so a projection that drops it fails there.

## Alternatives considered

- Batch the per-child reads into one query, or cache them: still a session-wide scan that grows with the history, and still a second source for what the history already records.
- A separate approval table, or an index over message parts: a new store for a fact the call's result already holds.
- Tag the result through the gate's `after` hook: coding-agent does not run `after` for a blocked call, because pi-agent-core builds that result itself, so the tag would be missing exactly where it is needed.
- Match the blocked text in the core: Durable wraps the reason in its `<harness>` diagnostics while coding-agent stores it bare, so the core would have to parse each harness's format.

## Consequences

- The parent model no longer learns that a live child is waiting for an approval: the unknown-id list and the status written after a compaction say `running`. People still see and answer the child's request in the parent session, and an unattended run blocks the call instead of waiting. This supersedes the `awaiting_approval` status in [Pi background subagents](../../proposed/feature/2026-10-14-agent-runtime-background-subagent.md) and the approval outcomes in [Shared agent behavior package](../../proposed/architecture/2026-10-18-agent-behavior-package.md).
- Hosts keep no approval outcomes for the rules. `listApprovalMessages` remains only for remote access, which reads it on request.
- The fake harness resumes only the runs a crash cut; input sent while conversations reopen starts its own run. Fewer await points per decision exposed this race in the fake.
- Not covered here: Durable's idle-context retention (`contextRetentionMs`), and writing a stream-presented answer to the database when the person answers rather than when the turn's projection settles.

## Verification

- Regression — goalHistory.test.ts: a round stops on a result blocked with a denial or with `NOBODY_TO_APPROVE`, and not on the same text without `blocked` nor on another block reason.
- Regression — idle.test.ts: a blocked denial stops the goal inside a goal round and not after a person's message.
- Regression — harness contract case "tools run under a stable call key; the gate blocks, rewrites and replaces" requires `blocked` equal to the gate's reason on the fake, coding-agent and Pi Durable.
- Regression — the same 10-round replay with this change: round time stays at 4.2–5.0 s after the first round (7.2 s), and the main process is busy for 7.9 s in rounds 9 and 10, none of it under `outcomesFor`.
- Regression — all 37 agent-behavior test files, the agent-runtime-pi behavior tests, the agent-runtime-pi-durable contract, harness and fold tests, and the Main Pi and Durable host tests pass.
