# Agent Note: Close Pi owners after session deletion

Status: implemented

English | [中文](2026-11-07-pi-deleted-session-shutdown.zh.md)

## Problem

The Agent navigation smoke completes its UI assertions but cannot close Electron. Deletion has already removed or trashed the session before runtime cleanup. Pi close issues user-stop, whose approval lookup requires an active archive; it throws before owner shutdown and leaves resources live.

## Decision

For an active archive, retain root and child user-stop semantics. When the archive is specifically not found, close the runtime owner directly: shutdown aborts and drains its native roots and children without querying deleted approval rows. Other database failures remain errors.

## Alternatives considered

- Skipping all user-stop calls changed existing child continuation behavior after reopening, which an existing test caught.
- Catching every interrupt error would hide native shutdown and database failures.

## Consequences

Soft-deleted and permanently deleted sessions can release their live Pi owner and complete workspace cleanup. Active-session continuation behavior remains covered by the existing runtime suite.

## Verification

- Regression — real SQLite tests for soft and permanent deletion failed before the fix with Pi interrupt: native-error.
- Regression — all 40 PiRuntimeConnection tests passed, including active child close and reopen contracts.
- Electron smoke rerun remains pending.
