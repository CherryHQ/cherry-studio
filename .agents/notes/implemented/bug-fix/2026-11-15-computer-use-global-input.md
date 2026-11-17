# Agent Note: Honor the user's global input choice in Computer Use actions

Status: implemented

English | [中文](2026-11-15-computer-use-global-input.zh.md)

## Problem

Computer Use actions that move the shared pointer or use the system keyboard (click, drag, scroll, typing, key presses) were always rejected on Linux with `PERMISSION_REQUIRED` ("This Linux action moves the shared pointer or keyboard; it needs allowGlobalInput: true"), because `ComputerUseService` passed `allowGlobalInput: false` into every SDK `act`/`perform` call. The literal came after the action spread, so no caller could override it, and the settings page offered no way to change it. Computer Use on Linux could therefore only observe apps and act on in-app accessibility controls; terminal input, pointer control and keyboard input were impossible no matter what the user configured.

## Decision

A new boolean preference `app.computer_use.agent_control.global_input` (default `false`), declared in `scripts/data-classify/data/target-key-definitions.json` and generated into the preference schemas. `ComputerUseService` reads it on each `act`/`perform` call and forwards it to the SDK as `allowGlobalInput`, so the user's choice applies to every current task on the next action, without a restart and without touching service state. The Computer Use settings page exposes the setting as a switch that is shown only while desktop control is enabled and persists independently of the control toggle. The default of `false` keeps the historical behavior for existing installations: global input stays off until the user explicitly opts in.

## Alternatives considered

Hard-coding `true` would silently give every agent control of the shared pointer and keyboard without any user consent — a security regression. Tying the choice to per-app approvals makes it an identity concern, but the runtime enforces it per action, not per application, so the mapping would be arbitrary. Reusing `agent_control.enabled` conflates "allow desktop control at all" with "allow global input"; that switch also stops all tasks, which users who only want to switch off global input would not expect. Reading the preference once at service init would make the value stale as soon as the user changes it; per-call reads keep it live at the cost of one preference lookup per action.

## Consequences

Enabling the switch exposes global pointer and keyboard input to agents on platforms where the runtime enforces it (the SDK documents the Linux pointer/keyboard paths), and on Wayland the environment may still require the Remote Desktop portal grant. Disabling it restores the strict behavior, where such actions are blocked and agents keep observing apps and using their accessibility controls. Existing installations are unaffected until the user turns the switch on, and changes take effect from the next action onward. The value is forwarded to the runtime as-is; which actions actually require it is platform-specific and decided by the runtime.

## Verification

- Regression — `src/main/services/__tests__/ComputerUseService.control.test.ts` ("sends the user global input choice to SDK act and perform calls"): SDK `act` and `perform` receive `allowGlobalInput: false` by default and `true` once the preference is flipped; covers both the `act` path and the `perform` executor branch.
- Regression — `src/renderer/pages/settings/__tests__/ComputerUseSettings.test.tsx` ("shows global input only while desktop control is on and persists the user choice"): the switch is absent while desktop control is off, appears after enabling it, and clicking it persists `app.computer_use.agent_control.global_input`.
- Tests — `pnpm test:main` over `ComputerUseService.control.test.ts`, `ComputerUseService.test.ts`, `ComputerUseService.approval.test.ts`, `ipc/handlers/__tests__/computerUse.test.ts` (32 tests) and `pnpm test:renderer` over `ComputerUseSettings.test.tsx` (6 tests), all passing.
- Checks — `pnpm typecheck` (all projects), oxlint + ESLint on the changed files, `pnpm i18n:check` (115,933 translations), and `pnpm docs:check` all pass; the new strings are translated in all 16 locales.
