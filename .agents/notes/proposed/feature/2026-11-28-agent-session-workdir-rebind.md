# Agent Note: Rebind an Agent session's work directory after messages exist

Status: proposed

English | [中文](2026-11-28-agent-session-workdir-rebind.zh.md)

## Problem

In an Agent conversation that already has messages, the work-directory control in the conversation header (or under the composer in a narrow window) opens the current directory in File Explorer instead of the directory picker. The user cannot move the session to another directory, and "Add a new working directory" is unreachable, so the work has to be restarted in a new conversation ([#22036](https://github.com/CherryHQ/cherry-studio/issues/22036)). A second occurrence reports the same gate from the other side: a Work task on the Pi runtime started without a work directory shows "No work directory" in the task top bar, and the selector is disabled once messages exist.

The block is deliberate end to end, not a wiring bug:

- The renderer passes a workspace-change handler only for an empty conversation (`canChangeWorkspace` in `AgentChat.tsx`). Without it, `AgentConversationControls.tsx` renders an `OpenTargetButton` (open in Explorer) in place of the picker.
- The backend enforces the same rule: `PUT /agent-sessions/:sessionId/workspace` rejects a session that has any message, as documented on `setSessionWorkspace` in `src/renderer/hooks/agent/useSession.ts`.
- A persisted DSH session rejects a changed working directory at resume time with a JSON-RPC cwd-mismatch error ([#20457](https://github.com/CherryHQ/cherry-studio/issues/20457)). Simply ungating the UI and the endpoint would move the failure from the picker to the runtime.

The reported expectation is that the control opens the picker in a conversation with messages too, that choosing another directory moves the session, and that subsequent tool calls resolve paths against the new directory. The provider's own feedback response on the issue asks for exactly this feature to be designed.

## Proposal

Allow rebinding an Agent session's workspace after messages exist, with explicit semantics so the runtime boundary stays safe.

*Semantics.* A rebind changes the workspace for future turns only. Conversation history is immutable: earlier tool outputs, file references, and paths stay exactly as recorded against the old directory. A successful rebind records a workspace-changed event on the session, carrying the previous and the new workspace, so a later resume can tell a deliberate rebind from a corrupt one. The next turn also surfaces the rebind to the model, so it does not assume paths from before the change still resolve.

*Backend.* `PUT /agent-sessions/:sessionId/workspace` accepts sessions with messages. It rejects a rebind only while a turn is in flight, with reason `turn_in_flight`, because swapping the directory under a running turn would re-resolve its paths mid-execution. The empty-session path is unchanged.

*Runtimes.* A runtime that resolves its working directory per turn picks up the new workspace on the next turn. A runtime that binds cwd when its engine session is built (the DSH persisted-session path) cannot rebind in place: on the first turn after a recorded workspace-changed event it starts a new engine session under the new cwd while keeping the Cherry session and its messages, instead of failing with the cwd-mismatch error. An unexpected mismatch (no recorded event) keeps failing closed, so #20457's corruption guard is preserved.

*UX.* The work-directory control opens the picker for sessions with messages, same as for empty ones, including the "Add a new working directory" entry. Sessions with no work directory (system workspace) can pick a directory the same way, which covers the Pi-runtime occurrence. Changing the workspace on a session with messages asks for confirmation first; the copy says that subsequent tool calls resolve paths against the new directory and that earlier outputs keep their original paths. While a turn runs, the control is disabled with a tooltip naming the reason.

## Alternatives considered

- Keep the restriction and improve the copy only: rejected, because the issue asks for the capability, and the provider's feedback response on it asks for the feature to be designed.
- Fork on rebind (copy the conversation into a new session bound to the new directory): preserves every engine invariant, but breaks session continuity and doubles session-list clutter. It can be added later as an option; it is not the default.
- Silent in-place rebind for every runtime with no recorded event: the DSH resume path rejects the cwd mismatch, and without the event the runtime cannot distinguish intent from corruption (#20457).
- Ungate only the renderer: the backend already rejects non-empty rebinds, so the picker would fail at save time with a generic error.

## Acceptance criteria

- AC1 — In a session with messages, the work-directory control opens the picker, choosing another user workspace rebinds the session, and the next turn's tool calls resolve paths against the new directory (verification: renderer + unit)
- AC2 — An empty session keeps its current picker behavior with no confirmation step (verification: unit)
- AC3 — A session with no work directory and with messages can pick a directory through the same control (verification: renderer)
- AC4 — A rebind requested while a turn is in flight is rejected with reason `turn_in_flight` and the workspace stays unchanged (verification: unit)
- AC5 — A persisted DSH session resumed after a recorded workspace-changed event starts a new engine session under the new cwd instead of failing with the cwd-mismatch error; an unrecorded mismatch still fails closed (verification: unit)
- AC6 — Rebinding a session with messages shows the confirmation copy first, and earlier tool outputs in history keep their original paths (verification: renderer)
- AC7 — The session records the workspace-changed event with the previous and new workspace, and the next turn surfaces the rebind to the model (verification: unit)

## Risks

- Model continuity: the model may keep using paths from before the rebind. The recorded event and the surfaced rebind note mitigate this; AC7 tests it.
- Race with in-flight turns: a rebind landing mid-turn would re-resolve a running turn's paths. AC4 makes the rejection explicit.
- Per-runtime adoption: each runtime's resume path must honor the recorded event. A runtime that misses it moves the failure from the picker to resume time, which AC5 guards for the DSH path; other runtimes need the same check as they are verified.
