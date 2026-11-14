# Agent Note: Opt in to Computer Use global input

Status: proposed

English | [中文](2026-11-14-computer-use-global-input.zh.md)

## Problem

`ComputerUseService` hardcodes `allowGlobalInput: false` after the action spread at three sites: native `act`, native `perform`, and the fallback `act` in `perform`. Linux actions needing global input fail the runtime permission gate. Hyprland virtual keyboards offer no dialog to approve this flag.

## Proposal

Use a separate default-off `app.computer_use.global_input.enabled` preference. Resolve it once per invocation after approval, client acquisition and availability checks, immediately before dispatch. Apply it after the action spread at all three sites so it overrides caller flags in both directions. Keep tool and automation schemas unchanged.

Retain the stored choice while the master desktop-control toggle is off; the disabled child switch still displays its stored value. Use independent save state and errors. Make reported Remote Desktop portal, GNOME Shell and KDE Plasma integration rows requestable through the existing permission route and predicate; unknown ids stay non-requestable.

Never remap runtime errors or replace their effect metadata. `PERMISSION_REQUIRED` with the preference off can also mean a missing OS grant. Explain scope and retention in the switch help text. This decision leaves application approval, ownership, stop, cleanup, abort and availability behavior intact.

## Alternatives considered

- Piggyback on the master toggle: grants global input without a separate choice.
- Auto-enable on Linux: grants access by platform rather than user opt-in.
- Recognise `PERMISSION_REQUIRED` by message text: hides missing OS grants and overrides runtime-authored diagnostics and effect.

## Acceptance criteria

- AC1 — All three dispatch branches honor the preference despite opposite caller flags, and an open session observes changes on its next action. (verification: unit; owner: worker)
- AC2 — Off permits semantic dispatch and SDK permission failures propagate by identity, code and effect. (verification: unit; owner: worker)
- AC3 — The switch defaults off, saves opt-in, shows stored true while disabled and reports a separate save failure without false success. (verification: renderer; owner: worker)
- AC4 — The portal row requests its reported id, unknown rows have no button, and the route schema accepts all five ids and mixed lists but rejects unknown and empty lists. (verification: unit and renderer; owner: worker)
- AC5 — Hyprland pointer and virtual-keyboard delivery work after opt-in, and portal grants survive the settings-client to task-client handoff. (verification: Electron on Linux; owner: Linux maintainer)
- AC6 — Product accepts the separate default-off choice and retention behavior. (verification: product review; owner: maintainer)

## Risks

Linux actions requiring global input stay blocked until the user opts in. Enabling the setting does not promise action success: OS grants, compositor support and runtime constraints still apply.

The control tests cover dispatch authority, both caller override directions, per-call reads on an open session, semantic dispatch and unchanged runtime rejection. Settings tests cover opt-in, disabled retained true, save failure and translated portal requests. Direct IPC schema tests cover all five ids, mixed lists, unknown ids and empty lists. Actual gate outcomes are in the worker report; test presence does not prove a passing run.

Hyprland pointer/virtual-keyboard delivery and portal-grant lifetime across the settings client and task client remain unverified: this host has no Linux desktop. Keep this note proposed until runtime verification and the product decision are accepted.
