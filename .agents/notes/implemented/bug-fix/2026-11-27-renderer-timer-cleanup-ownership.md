# Agent Note: Scope renderer timer cleanup to its own registration

Status: implemented

English | [中文](2026-11-27-renderer-timer-cleanup-ownership.zh.md)

## Problem

Scheduling a named timer replaces its earlier registration. A cleanup function returned by the earlier call still cleared the key, which could cancel the replacement.

## Decision

Cleanup returned by a scheduling call clears the timer only while its handle is still registered for that key. Explicit key-based clear operations still clear the current timer.

## Alternatives considered

- Using the key alone cannot distinguish which registration owns a returned cleanup.

## Consequences

Owners can clean up earlier scheduling calls without cancelling replacement work. Timeout and interval namespaces remain independent.

## Verification

- Regression — `src/renderer/hooks/__tests__/useTimer.test.ts`: stale cleanup leaves a replacement timer running, and current cleanup and explicit clear still stop timers.
