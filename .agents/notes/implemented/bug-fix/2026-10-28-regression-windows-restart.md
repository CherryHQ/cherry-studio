# Agent Note: Use normal Windows shutdown for regression restarts

Status: implemented

English | [中文](2026-10-28-regression-windows-restart.zh.md)

## Problem

The Windows regression controller restarted Electron by calling `taskkill /T /F` on its runner. Persistence scenarios therefore exercised forced termination, which can interrupt normal shutdown and pending state writes. A restart failure alone could not distinguish a product persistence defect from this test precondition.

## Decision

Before a Windows restart, verify the owned Electron process and main-process inspector, request `app.quit()`, and wait up to 30 seconds for that Electron process to exit. Schedule the quit after acknowledging the inspector request so the controller can disconnect. Only then clean up the owned launcher and start the replacement with the same profile. A shutdown timeout fails the restart without forcing Electron to exit or launching a replacement.

Request normal shutdown only when the recorded Electron PID is still alive. If the owned launch has already exited, including before its main-window record was complete, perform the existing ownership-checked cleanup and launch the requested profile. A recycled live PID still has to pass ownership checks. This recovery does not establish why the previous process exited.

## Alternatives considered

- Flushing individual storage APIs in the test would bypass the normal product shutdown path.
- Falling back to forced termination would silently turn persistence acceptance into crash recovery testing.

## Consequences

Windows persistence scenarios now request normal application shutdown. Final cleanup retains its existing owned-process termination policy. macOS behavior is unchanged. Product failures after normal shutdown remain failures; this repair does not establish that drafts, file previews, or conversation selection satisfy their acceptance contracts.

## Verification

- Regression — `scripts/e2e/regression/__tests__/gracefulRestart.test.ts`: normal shutdown saves pending state, a foreign inspector is rejected, and a blocked quit retains the running application and pending state.
- Regression — `launch.test.ts` covers recovery after an exited launch, both before and after the main-window record is complete, on both platforms. Windows process fixtures in `lifecycle.test.ts` use Windows paths even when the tests run on macOS.
