# Agent Note: Preserve the default protocol handler in isolated development profiles

Status: implemented

English | [中文](2026-11-07-isolated-profile-protocol-handler.zh.md)

## Problem

An E2E instance with `CS_DEV_PROFILE_ROOT` still registered itself as the system default for `cherrystudio://`. Deleting its temporary runtime could leave links pointing at a removed application. Filesystem isolation alone did not protect the user's protocol association.

## Decision

`ProtocolService` skips default-handler registration and AppImage desktop-entry setup when the validated development profile root is present. Its URL listeners, startup arguments, and second-instance routing remain active. Packaged applications ignore this development override and retain normal protocol registration.

## Alternatives considered

Saving and restoring the handler around each run cannot prevent interference while tests run and can overwrite a user's concurrent change. Removing URL handling entirely would prevent explicit deep-link verification inside an isolated instance.

## Consequences

System-opened links continue to use the user's installed application. An isolated developer instance receives deep links through explicit launch arguments or events; it does not claim the global scheme. Existing default associations are not changed automatically by this repair.

## Verification

- Regression — `ProtocolService.test.ts`: both isolated-launch variants overwrote a seeded installed handler before the repair and preserve it afterward, while startup deep links still reach navigation.
- Regression — `pnpm exec vitest run --project main src/main/services/protocol/__tests__/ProtocolService.test.ts src/main/core/paths/__tests__/constants.test.ts`: 46 passed, covering normal registration arguments and packaged/profile-root validation.
