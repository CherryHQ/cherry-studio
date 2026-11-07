# Agent Note: Observe native state before accepting desktop actions

Status: implemented

English | [中文](2026-11-07-native-controller-state-observation.zh.md)

## Problem

Native automation failures obscured product results. Windows save scripts exceeded the command-line limit, address-bar input could reach another foreground window, and profile deletion could precede the fixture's exit callback. macOS clock controls moved between system processes and gained grouping containers. A depth-first notification-panel inspection traversed content before the sibling toolbar; hosted clock lookup also consumed most of the former ten-second process budget.

The controller also restarted a healthy development renderer after twenty seconds even though hosted cold starts took about forty seconds.

The hosted macOS image build unloads the Notification Center launch agent; the observed runner initially had no loaded agent. Its plist filename and service label differ, so enabling a label inferred from the filename does not restore the actual agent.

## Decision

- Send Unicode PowerShell save scripts through standard input and verify the owned dialog and address-bar focus before typing.
- Find the visible Windows notification panel through its native shell window handle before querying its UIA tree. Hide metadata-query consoles.
- Request fixture shutdown through its owned pipe, yield until the child exit event, and escalate only after rechecking process ownership.
- Find the macOS clock by its accessibility identifier inside known system menu hosts, including grouped MenuBarAgent controls. Search panel levels before descending into notification or widget content, keep a thirty-second native-operation budget, and require the requested open/closed state.
- Restrict the permission observer to initialized directories on disposable hosted macOS runners and stop it before application cleanup.
- Wait up to sixty seconds for a revealed macOS development renderer before replacing its process; a loading renderer alone does not prove process failure.
- Read the Notification Center service label from its plist, record the hosted GUI service's prior state, enable it for native checks, and restore that state in an always-run step.

## Alternatives considered

- Larger timeouts alone do not fix wrong-window input, oversized command lines or ownership races.
- Accepting a keypress or a notification history entry would not prove visible notification activation.
- Resetting developer permissions or terminating applications by name would cross the run's ownership boundary.

## Consequences

Adapters remain platform specific and fail when native state cannot be confirmed. Notification scenarios still require a real system notification click to return to the completed topic. Local execution does not run the hosted permission observer.

## Verification

- Regression — 41 process, system-automation and permission-observer tests passed; 30 notification and system-automation tests passed, including a panel-content traversal case that failed before the breadth-first repair.
- Regression — hosted Windows native checks passed all ten adapter cases, including real Unicode/suggested-name saves and fixture cleanup; the native syntax check also passed.
- Regression — local MP-110 and MP-111 passed with the current macOS controller, including actual notification activation, persisted settings and successful owned-runtime cleanup. Complete hosted acceptance remains a separate requirement.
- Regression — the hosted macOS native fixture passed real file selection and notification-panel open/idempotence/close checks after GUI-service preparation; the service restoration step also passed.

- Regression — the cold-renderer case failed before the wait repair and passed afterward; all three window-recovery tests passed.
- Regression — hosted macOS MP-110 and MP-111 passed together after the tray-startup case waited for visible application chrome; native checks, service restoration and cleanup passed.
