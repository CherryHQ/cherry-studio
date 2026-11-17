# Agent Note: Retain native notification callbacks until delivery ends

Status: implemented

English | [中文](2026-11-07-native-notification-callback-lifetime.zh.md)

## Problem

`NotificationService` created Electron notifications as local variables. Garbage collection could collect their JavaScript wrappers while the system still displayed them. A real macOS click then activated the application without invoking its conversation-navigation callback, leaving the user in Settings.

## Decision

The service holds each native notification until its click, close, or failure event. Both persisted notifications and direct system notifications use this lifetime owner. A synchronous show failure releases the reference, and service shutdown clears outstanding references.

## Alternatives considered

Keeping notifications only in a test observer would hide the production defect. Navigating from application activation would lose the notification target and interfere with normal activation. Retaining every notification for the entire process lifetime would accumulate completed wrappers.

## Consequences

Collection no longer removes live click callbacks. Terminal delivery events release their wrappers. Shutdown drops service references without deleting the user's persisted notification records or clearing their system notification history. No storage format or IPC contract changes.

## Verification

- Regression — `NotificationService.test.ts`: five new garbage-collection cases fail without the repair and pass with it. They check unread-record consumption and conversation navigation after collection, plus release after click, close, failure, and service shutdown.
- Regression — `pnpm exec vitest run --project main src/main/services/__tests__/NotificationService.test.ts`: 123 passed with one existing platform-specific skip.
- Electron — a signed, isolated macOS probe confirms that a collected wrapper receives no JavaScript click event after a real native click; retaining the wrapper preserves that event after the same forced collection. Full business-notification E2E verification is recorded separately in the PR.
