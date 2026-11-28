# Agent Note: Release completed renderer timeout registrations

Status: implemented

English | [中文](2026-11-27-renderer-timeout-expiry.zh.md)

## Problem

A mounted component can schedule one-shot timeouts under many keys. When a timeout fires, the platform releases the timer but the hook retained its registration until explicit cleanup or unmount.

## Decision

The hook removes the completed registration before invoking its callback. A callback that schedules a replacement under the same key owns the new registration.

## Alternatives considered

- Deleting the key after running the callback could delete a replacement or miss cleanup when the callback throws.

## Consequences

Named clears continue to apply to live timers. Long-lived components retain only pending timeout registrations.

## Verification

- Regression — `src/renderer/hooks/__tests__/useTimer.expiry.test.ts`: completed or throwing timeouts are released, and a callback can replace its own key.
