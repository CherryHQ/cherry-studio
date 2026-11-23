# Agent Note: Stop startup when the database schema is newer

Status: implemented

English | [中文](2026-11-23-ahead-database-at-startup.zh.md)

## Problem

An older build can open a database whose latest applied migration is newer than any bundled migration. Drizzle skips applying SQL in this case, and business writes can later fail against constraints the old build does not know about. Issue #22907 reports a knowledge-base insert failing on an unexpected required column.

## Decision

Read the latest applied migration timestamp before `DbService` configures WAL, applies migrations or seeds data. A strictly newer timestamp stops startup. The application shows localized upgrade guidance and exits. A missing migration journal is allowed during startup so a new database can still be initialized.

## Alternatives considered

- Checking when a knowledge-base write fails would leave other writes exposed to the same schema mismatch.
- Using the full restore prefix rule during startup would additionally block same-age forks and change which existing profiles can start.

## Consequences

Users opening a profile from a newer build are told to update before retrying. The restore path keeps its full-chain comparison and continues to require an applied journal.

## Verification

- Regression — Real SQLite fixtures cover older, matching and newer migration timestamps. The newer file remains byte-for-byte unchanged and retains its journal mode.
- Regression — The startup error test verifies localized update guidance and exit. Restore promotion tests cover the existing restore behavior.
