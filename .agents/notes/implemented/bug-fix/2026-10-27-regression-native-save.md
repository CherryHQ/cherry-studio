# Agent Note: Keep native save automation asynchronous and case-owned

Status: implemented

English | [中文](2026-10-27-regression-native-save.zh.md)

## Problem

Regression scenarios serve model and image fixtures in the Playwright worker. A synchronous native-save subprocess blocks that worker while waiting for a dialog. Image export may need those same HTTP fixtures before opening the dialog, so neither side can finish. A failed export can also leave a native save dialog that intercepts another scenario's download; a Windows run saved DOCX bytes to a later Python filename this way.

Windows folder selection can also accept the default directory when process activation does not focus the native dialog. Sending the path through SendKeys interprets braces and other characters as keyboard commands.

## Decision

`saveNativeFile` returns a promise and every consumer awaits it. Native automation leaves the worker event loop free while waiting for the owned dialog. Windows dialog discovery allows preparation time for long image exports. Word checks wait for a readable archive with valid CRCs, rather than treating file creation as completed writing.

Scenario cleanup cancels only Windows file dialogs belonging to the verified driver-owned Electron process. It recognizes a native file input and Cancel button instead of dismissing arbitrary windows or accepting a pending save.

Windows folder selection activates the owned dialog by its native handle and verifies foreground ownership before sending keys. It opens the address field and uses native text messages to write and read the literal path, then waits for the same dialog to close or leave address-editing mode before accepting. The caller retains its exact selected-directory assertion, including spaces and braces in the workspace path.

## Alternatives considered

- Increasing a synchronous timeout keeps the fixture server blocked.
- Catching export errors or accepting any nonempty file hides broken output and cross-case contamination.
- Restarting Electron after every failure hides the leaked dialog and discards shared-run behavior.
- Longer keyboard delays do not verify focus or preserve literal path characters.
- UI Automation SetFocus depends on the provider and does not guarantee foreground activation; use the native window activation API and verify the result.
- The tested Windows automation host does not expose ValuePattern for the address field. Native edit-control messages preserve literal text without requiring that pattern.

## Consequences

Callers must await the helper. Cleanup adds a native automation round trip on Windows and does not provide equivalent macOS file-dialog cancellation. Product assertions and unsuccessful exports still fail normally.

## Verification

- Regression — `scripts/e2e/regression/__tests__/systemAutomation.test.ts`: a real HTTP fixture is served while native-save completion is pending; a changed process identity prevents dialog cancellation.
- Local Windows ARM64 MP-47 verifies Markdown, Word content and a long image; MP-128 verifies screenshot saving and clipboard pixels. Both pass after the repair. macOS native saving has not been rerun locally.
- Regression — `CODE-01` checks the exact selected workspace before launching; native Windows folder entry is also exercised with Chinese characters, quotes and braces.
