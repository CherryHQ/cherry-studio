# Agent Note: Unified approval presentation for Pi, Pi Durable and Claude Code

Status: proposed

English | [中文](2026-11-10-unified-agent-approval-presentation.zh.md)

## Problem

A child tool can wait for approval while the user sees only a running task. Pi and Pi Durable share `createPiInteractionPorts`: the request contains the tool name and input, but Main's stream branch reduces it to approval and tool-call IDs. The root reply may not contain the child's tool input, so `RootMessageProjection` cannot produce a card. Claude Code currently chooses an independent message for child interactions inside its adapter. Correct presentation therefore depends on runtime-specific choices and event ordering.

The November 10 investigation reproduced the missing-card path using the installed 2.2.0 projection implementation and the affected session's persisted message parts. Native storage showed a child write stopped before execution and its parent waiting. The production in-memory approval queue was not inspected; this establishes a presentation defect and a matching incident, not complete proof of the incident's suspended stack. Session contents, identifiers and local diagnostic artifacts are not part of this Spec.

This is a new shared presentation contract within the ownership split described by [runtime boundary ownership](../simplification/2026-11-05-agent-runtime-boundary-ownership.md). It partially supersedes the presentation-specific cleanup assumption in [abandoned approval cards](../../implemented/bug-fix/2026-11-06-retire-abandoned-approval-cards.md); that note's cancellation, user-denial attribution and undelivered-answer behavior remain applicable. No shipped behavior changes with this proposed document.

## Proposal

### Scope and ownership

Unify how requests that already require a human response are presented, answered and retired. Include permission prompts, user questions and plan confirmations that use the existing approval channel. Preserve each runtime's permission rules, automatic approvals, explicit denials, headless restrictions and native recovery semantics. Do not add automatic authorization, new tool capabilities, an approval database, a generic runtime framework or a second callback registry.

| Owner | Responsibility |
| --- | --- |
| Runtime adapter | Decide whether native execution needs a response; supply complete tool input, trusted origin and cancellation signal; translate the neutral decision into the native result. |
| `ToolApprovalRegistry` | Own the live callback and at-most-once settlement; retain the host-selected response anchor for that registration. |
| `AgentSessionRuntimeService` | Validate connection ownership, bind the canonical record, project task and child entry points, validate responses and publish lifecycle events. |
| Existing message services and projections | Persist or project the selected card; preserve its identity across later tool snapshots. |
| Renderer | Render the shared interaction and submit the approval identity plus its bound anchor; never infer execution ownership from the visible panel. |

### Complete request and explicit origin

Extend `AgentRuntimeToolApprovalRequest` with a discriminated origin: root or child. Root origin identifies the native context and requesting reply when known; child origin carries the native child identity within the connection's backend and the confirmed product child session when available. Correlation is scoped to the originating connection/context, not a globally unique assumption about `toolCallId`. A child whose product projection is not ready remains a child; do not guess a session from titles or whichever panel is open.

Keep `approvalId`, `toolCallId`, `toolName`, complete `input` and tool rendering metadata. Remove adapter-selected `presentation` after all three adapters migrate. Resolve origin from Pi's `CallRef.thread`, Durable's backend/conversation ownership and Claude's evidenced SDK agent identity. If Claude cannot yet map a native child to a product session, retain its native origin and display a generic child source label; the missing link must not delay the approval.

Adapters register the native callback before emitting the complete request, using the existing registry. Main binds the presentation anchor to that same live registration. Unpresented is an explicit transient state, not a default stream anchor. A request from an obsolete connection, an already cancelled registration or unavailable human-response surface must settle without leaving a pending callback. Logs contain correlation IDs and failure reasons, not tool input or question answers.

### One approval, multiple entry points

Execution belongs to the child. Main owns approval registration and decision validation; the parent conversation supplies an operation entry point, and the notification system reminds the user. Neither parent projection nor notification starts another model turn.

Keep one canonical message anchor per registration. Root requests can use their active reply; child requests use an existing message-store record carrying complete input, native origin and registration identity. This storage anchor is independent of where the approval is displayed. A derived shared-cache projection resolves trusted child contexts and spawn calls; it contains no callbacks and cannot authorize execution.

Pending approvals replace the parent composer while retaining its draft, and appear in a composer footer below the child process. Both answer the same canonical anchor. Multiple pending requests can be selected in the composer. Task areas retain waiting counts and navigation, including when collapsed, but contain no approval forms. Standalone approval storage records do not render as assistant replies. If no product task can be resolved, the parent composer still shows the sourced request. Notification navigation selects the canonical approval and opens its child task when available. Late task association changes the projection, never the anchor. Preserve native task status separately from approval state.

### Notifications follow approval lifetime

After persistence and registration validation, publish a notification keyed by registration identity with conversation, task and canonical approval location. The notification center persists pending and terminal state; reading is independent of processing. Accepted approval, denial, cancellation and expiry update the shared projection and notification. In-app reminders close and OS dismissal is best effort. Activation re-reads the current notification and opens the conversation/task; it never authorizes execution. Notification delivery failure cannot break an actionable approval.

On startup, persisted pending notifications without a live registration become expired. Stored approval cards cannot recreate callbacks. A recovered Durable request has a new registration and notification even if its native approval ID is reused.

### Response, cancellation and races

Validate every answer against the live registration and its bound message/session anchor, including inline approvals. Apply the accepted decision to that anchor before releasing the native callback. The first accepted answer wins; duplicate clicks, wrong anchors, stale connections and answers to a retired registration cannot authorize execution. Approved input edits go to the original callback, and every visible view converges to the accepted input and decision. Persistence failure reports a failed response and does not run the tool; retain the pending card for an explicit retry if its callback is still live.

Use the existing `onAborted` path for cancellation, but clean up by the bound anchor rather than by an adapter's stream/message choice. Cancellation before publication prevents an actionable card. If cancellation races with persistence, reconcile after the write and retire any row that was created. Parent-turn settlement does not cancel an independent child request by itself. Native task stop, session shutdown and connection replacement retain their existing cancellation ownership and retire affected anchors. Closing a child panel only detaches observation.

For legacy unregistered requests, retain the existing first undelivered-answer handoff described in the abandoned-card note: a question answer may become user text, but must never silently approve a tool or be dispatched to a recovered callback. Duplicate handoffs remain rejected. Registered requests, including child questions, never create a parent model turn when delivery fails. On reopen, a stored card alone never recreates a callback. Pi Durable may reissue an approval through native recovery; Pi and Claude Code follow their existing continuation behavior. Old anchors remain unusable in every case.

Remote interactions expose an optional registration identity that clients echo on response. Registered requests reject missing or stale identities. Decimal revisions retain their existing meaning; old clients can read new interactions but must update or use Desktop to answer them.

### Implementation and verification sequence

1. Change the common request/origin and bound-anchor contract with all three adapters and real consumers in one type-complete change. Replace adapter presentation choices and update response/cancellation handling together; no permanent compatibility branch.
2. Add shared projection and real-database service regressions, plus per-runtime adapter coverage. Verify early approval, child source mapping, duplicate delivery, edited input, presentation failure, cancellation during persistence and old-anchor rejection after recovery.
3. Verify the user flow in isolated Electron profiles for Pi, Pi Durable and Claude Code, including two windows and a closed child panel. Record controlled-provider evidence separately from live-provider evidence; do not use the production session as a fixture that executes tools.

The implementation owner supplies evidence for each criterion. Unit ownership is split between the shared approval/session modules and each adapter; persisted-message tests use `setupTestDatabase()` with production migrations. Run explicit affected test files and changed-file checks only. This Spec's writing and documentation checks do not count as implementation or runtime acceptance.

## Alternatives considered

- Patch Pi and Durable to choose independent messages like Claude: smaller locally, but leaves display policy and cancellation assumptions spread across adapters.
- Always put every approval in an independent message: robust but unnecessarily separates ordinary root tools from their existing cards.
- Emit a synthetic tool-input chunk before every approval: fixes one ordering case but preserves two-event coupling and does not establish child origin or response ownership.
- Put actionable child approvals only inside the child panel: hides blockers when the panel is closed and makes approval visibility depend on navigation.
- Move cards into tool messages when those messages eventually arrive: invalidates response anchors and introduces duplicate-click races across windows.
- Add a persistent approval queue or change all runtime permission policies: expands scope and duplicates native execution/recovery ownership without fixing the presentation boundary.

## Acceptance criteria

- AC1 — A root approval arriving before its tool message displays complete input exactly once and remains correctly associated when tool snapshots arrive. (verification: unit; owner: shared projection/session)
- AC2 — For each runtime, a child interaction is answerable in the root conversation with the child panel closed, both during and after the parent's reply; confirmed source identity is retained. (verification: unit + Electron; owner: adapters and session UI)
- AC3 — Approve, deny, question answer and approved input edits reach the original native callback exactly once, with both composers retiring the request and notifications reflecting the accepted decision. (verification: unit + Electron; owner: registry and adapters)
- AC4 — Concurrent windows, duplicate events, wrong anchors and late answers cannot execute a tool twice or authorize a different/recovered call. (verification: unit + Electron; owner: registry/session)
- AC5 — Cancellation before, during and after card persistence leaves no actionable orphan or stranded callback; closing only the child panel does not cancel execution. (verification: unit + Electron; owner: session lifecycle)
- AC6 — Missing response surfaces, stale connections and presentation failures settle explicitly without automatic authorization; a response persistence failure does not execute the tool. (verification: unit; owner: session/registry)
- AC7 — Reopening follows each runtime's native recovery policy; old cards cannot answer reissued requests, and the existing undelivered-answer handoff occurs at most once. (verification: unit + Electron; owner: adapters and session UI)
- AC8 — Existing per-runtime permission policies and headless restrictions remain unchanged, and all three adapters use the common host presentation path without a new approval store. (verification: unit + source review; owner: adapters)
- AC9 — Parent and child composers share one canonical approval without extra assistant bubbles; settlement restores the parent draft, late task mapping preserves the anchor and collapsed task lists retain pending counts. (verification: unit + Electron; owner: session UI)
- AC10 — Notifications carry precise approval location, distinguish read from processed, retire on terminal outcomes and expire after restart; delivery failure leaves approvals answerable. (verification: unit + Electron; owner: notification/session)

## Risks

Native child identity may precede product child-session creation. Preserve the native origin and allow an unlinked source label instead of blocking or guessing. Tool-call IDs may repeat across contexts, and Durable approval IDs may recur after recovery; scoping and frozen anchors are mandatory.

A callback registry and persisted message cannot commit atomically together. Keep the cancellation signal attached throughout presentation, bind against the same live registration, and reconcile completion of asynchronous writes. Do not claim exactly-once effects across process crashes; native replay rules still own execution safety.

Moving presentation ownership touches response and teardown as well as rendering. Migrating only the request event would leave the current `presentation` branches inconsistent. Existing stored messages must remain readable, and a test-only projection reproduction is insufficient to claim all three runtimes work in Electron.
