# Agent Note: ACP configuration snapshots and request cancellation

Status: implemented

English | [中文](2026-10-22-acp-config-and-request-cancellation.zh.md)

## Problem

Promoting mode, model and reasoning controls removed their positions from the ACP configuration array and discarded categories. Reconstructing the menu changed native priority and separated model parameters from model selection. Request handlers also waited for user approval after the agent cancelled the individual JSON-RPC request.

## Decision

Keep the complete supported configuration snapshot in native order, including categories and grouped choices. Derived mode and model views retain existing APIs; the renderer avoids duplicate controls. Model parameters appear inside the model picker and change only the native session. Global model selection retains its existing CLI-default persistence. Complete configuration updates remove obsolete controls and model catalogs; unknown option types are ignored.

Use the SDK's request cancellation signal with the existing approval registry, alongside connection and turn cancellation. Cancelled permissions and questions return their native cancellation outcomes. Cancelled file and terminal operations return request cancellation errors before unapproved effects. Cancelling a terminal wait does not terminate its process. The ACP handshake reports the application version.

## Alternatives considered

- Add position fields to separately stored controls: duplicates ordering state that already exists in the native array.
- Implement another JSON-RPC cancellation dispatcher: duplicates SDK behavior and loses request ownership.

## Consequences

No database migration or additional global configuration store is needed. Cancellation is cooperative: an operation already performed cannot be undone. Client-owned terminals remain subject to explicit release and connection cleanup.

## Verification

- Regression — `pnpm exec vitest run src/main/ai/runtime/localAgent/__tests__/connections.test.ts`: 113 cases pass, including native ordering, unknown types, complete replacement and request cancellation for permissions, forms, writes, terminal creation/waits and Cursor extensions.
- Regression — Targeted renderer tests cover configuration ordering without duplicates, grouped translated options and model parameters using session configuration instead of global model persistence.
- Electron — Controlled ACP fixtures verify ordering, complete replacement and session-only model parameters in light and dark themes; nested menus remain above the model picker. The wire handshake reports application version `2.1.7`.
- Real agent — Pi ACP `0.0.34` exposes model and reasoning settings. A session reasoning change and restoration succeeded without inference or global configuration changes; Pi does not advertise `model_config`.
