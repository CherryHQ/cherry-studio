# Agent Note: Desktop control state in Agent session details

Status: implemented

English | [中文](2026-11-09-desktop-control-status.zh.md)

## Problem

While the assistant drives a desktop application, the only surface that shows which application is controlled, whether control is still held, and how to stop it is the tray submenu. The Agent session details card is where the user already looks during a run, yet it says nothing about desktop control, so the chat text is the only clue that using the mouse and keyboard right now may interfere. Stopping a running control requires knowing that the tray menu exists.

## Decision

The Agent session details gain a Desktop control group, rendered by `AgentSessionDetailsSections` as the ninth configurable section (default visible, immediately after workspace). It lists one row per application controlled by the current Agent session: application name, localized control status, and a Stop action for `opening` and `active` rows. `stopping`, `stopped` and `unconfirmed` rows stay visible without a Stop. There is no renderer Allow action and no renderer Stop all. The group renders nothing when the current session controls no application.

State comes from a new IPC projection of the existing `ComputerUseService` model: `computer_use.get_controls` returns `ComputerUseControl[]`, `computer_use.stop_app` stops one application, `computer_use.stop_all` stops every control, and `computer_use.controls_changed` pushes a full snapshot whenever the service's `changed` emitter fires. The service owns that bridge in `onInit`, so tray-initiated stops, settings revocation and native close callbacks reach the renderer without polling. The renderer keeps one subscriber per details scope: it subscribes before the bootstrap request, replaces snapshots wholesale (including an empty array), discards a bootstrap reply superseded by an event, and treats a failed bootstrap as unknown rather than released.

Rows are scoped to the exact Agent owner identity `agent:<sessionId>:<agentId>`; controls belonging to other sessions are not shown and label text is never used as identity.

Two service changes back the acceptance contract. `stopAll()` records each task's application identities in the owner's `blockedApps` before finishing tasks, so a confirmed stop-all leaves named `stopped` rows instead of erasing them; this is the mechanism single-application Stop already used. Live rows still override remembered rows, so cleanup reports `stopping` or `unconfirmed` until it settles, ordinary confirmed task completion still removes controls, and `owner.stopped` continues to block every application, including ones not seen yet. Because the tray renders the same model, its unchanged menu now also lists those remembered stopped rows after stop-all. Separately, `stopApp()` now fires its change notification when it only records a blocked application that has no live task, so the projection cannot silently miss a row it reports through `get_controls`.

## Alternatives considered

- Tray-only disclosure with clearer labels: no in-app visibility, and it still requires knowing that the tray menu exists.
- A persistent indicator outside the session details: duplicates a per-session concern on a second surface, and the recorded product decision chose the session details.
- Renderer-side history of released applications: cannot survive a remount or restart, and would disagree with `get_controls`.
- Projection only, without `stopAll()` retention: the released-applications-show-stopped acceptance fails because confirmed cleanup deletes the identities.
- An owner-level all-applications row instead of per-application rows: shows aggregate state, not which application was released, and has nothing to stop.

## Consequences

- A resolved `stop_app` reply means the command settled, not that cleanup was confirmed; only the pushed snapshot changes a row's status, so the UI never claims a stop that did not happen.
- `ControlStatus` gains no new values; waiting-for-user and current-action remain out of scope and would extend the tray contract as well.
- Older saved section arrays receive the new group at the end, while default profiles place it after workspace. Hiding the group changes presentation only, and the tray remains the alternative.
- Nine strings were added to every renderer locale.

## Verification

- AC1 — `src/main/ipc/handlers/__tests__/computerUse.test.ts`: the real router and service return the exact control projection, strict `stop_app` inputs are rejected without mutation, one application's stop leaves the other controllable, and `stop_all` blocks every owner.
- AC2 — `ComputerUseService.control.test.ts`: two named applications survive a confirmed `stopAll()` as `stopped`; cleanup reports `stopping`, failed cleanup `unconfirmed`, and normal confirmed completion still yields no controls.
- AC3 — `TrayService.control.test.ts`: the unchanged tray menu lists the remembered stopped rows with the existing enablement rules, and per-application Allow does not unblock the owner.
- AC4 — `useAgentDesktopControls.test.tsx`: events replace snapshots including `[]`, a late bootstrap resolve or rejection loses to a newer event, and a failed bootstrap reports unknown and recovers on the next event.
- AC5 — `AgentSessionDetailsSections.test.tsx`: each application renders its name and localized status, Stop appears only for `opening` and `active`, terminal rows keep no action, no Allow is rendered, and empty or owner-only snapshots render no group.
- AC6 — `AgentRightPane.test.tsx`: rows are limited to `agent:<sessionId>:<agentId>` and a pending Stop stays bound to its application across a session switch.
- AC7 — `AgentDetailsCustomize.test.tsx` with the regenerated `preferenceSchemas.ts`: an older eight-entry saved list gains the visible group once at the end, hiding it stops nothing, and reset restores the default order.
- AC8 — `i18n-check` reports 101786 translations with no placeholders; scoped Oxlint, ESLint, Oxfmt and the renderer typecheck pass, and the main typecheck leaves only a pre-existing error in a file this change does not touch.
- AC9 — Electron with an injected projection: screenshots show the absent group with no controls, active and opening rows with Stop, terminal rows without Stop, another session's rows excluded, and the group disappearing after release.
