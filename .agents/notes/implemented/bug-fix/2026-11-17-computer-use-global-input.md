# Agent Note: Authorize global input for Computer Use actions

Status: implemented

English | Chinese counterpart: 2026-11-17-computer-use-global-input.zh.md

## Problem

The Computer Use service checks the existing desktop-control preference before actions, but then forced `allowGlobalInput` to `false` for every native action. Linux X11 and Wayland actions that require global pointer or keyboard input therefore could not use the permission the user had enabled.

## Decision

Pass `allowGlobalInput: true` for `act` and `perform` calls after the service's existing `assertAvailable` authorization check. Keep the existing preference, stop state, task ownership, and native permission checks as the gates; do not add a second setting or let callers bypass the service check.

## Alternatives considered

- Add a second Linux-only preference: duplicates the existing desktop-control authorization and creates conflicting states.
- Preserve `false` and ask callers to override it: callers cannot override a property written after their action, and the documented Linux input path remains unreachable.
- Remove the service-level value and rely on the native default: the native default is `false`, so required global input remains disabled.

## Consequences

Authorized Computer Use actions can request global input on Linux. The service still rejects actions while desktop control is disabled, stopped, or unavailable; macOS and Windows receive the same explicit action flag, which their native adapters already handle.

## Verification

- Regression — `src/main/services/__tests__/ComputerUseService.control.test.ts`: authorized `act` and `perform` calls include `allowGlobalInput: true`.
