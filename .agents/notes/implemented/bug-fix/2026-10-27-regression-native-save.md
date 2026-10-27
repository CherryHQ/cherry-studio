# Agent Note: Keep native save automation asynchronous and case-owned

Status: implemented

English | [中文](2026-10-27-regression-native-save.zh.md)

## Problem

Regression scenarios serve model and image fixtures in the Playwright worker. A synchronous native-save subprocess blocks that worker while waiting for a dialog. Image export may need those same HTTP fixtures before opening the dialog, so neither side can finish. A failed export can also leave a native save dialog that intercepts another scenario's download; a Windows run saved DOCX bytes to a later Python filename this way.

## Decision

`saveNativeFile` returns a promise and every consumer awaits it. Native automation leaves the worker event loop free while waiting for the owned dialog. Windows dialog discovery allows preparation time for long image exports. Word checks wait for a readable archive with valid CRCs, rather than treating file creation as completed writing.

Scenario cleanup cancels only Windows file dialogs belonging to the verified driver-owned Electron process. It recognizes a native file input and Cancel button instead of dismissing arbitrary windows or accepting a pending save.

## Alternatives considered

- Increasing a synchronous timeout keeps the fixture server blocked.
- Catching export errors or accepting any nonempty file hides broken output and cross-case contamination.
- Restarting Electron after every failure hides the leaked dialog and discards shared-run behavior.

## Consequences

Callers must await the helper. Cleanup adds a native automation round trip on Windows and does not provide equivalent macOS file-dialog cancellation. Product assertions and unsuccessful exports still fail normally.

## Verification

- Regression — `scripts/e2e/regression/__tests__/systemAutomation.test.ts`: a real HTTP fixture is served while native-save completion is pending; a changed process identity prevents dialog cancellation.
- Local Windows ARM64 MP-47 verifies Markdown, Word content and a long image; MP-128 verifies screenshot saving and clipboard pixels. Both pass after the repair. macOS native saving has not been rerun locally.
