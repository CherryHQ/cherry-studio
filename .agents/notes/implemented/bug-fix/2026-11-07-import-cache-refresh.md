# Agent Note: Refresh imported conversations in mounted lists

Status: implemented

English | [中文](2026-11-07-import-cache-refresh.zh.md)

## Problem

MP-120 successfully imported two ChatGPT conversations into SQLite, but returning to Chat still showed the cached assistant list. ImportService writes directly through DataApi and does not run the mutation hook that normally refreshes those lists.

## Decision

Invalidate the assistant and topic query collections after a successful import, before dismissing the import popup. Keep imported messages and rollback behavior unchanged.

## Alternatives considered

Reloading the window would discard unrelated UI state. Changing the service into a React hook would broaden the repair unnecessarily.

## Consequences

Already mounted lists fetch the newly imported records. Failed imports do not announce successful completion.

## Verification

- Regression — `ImportPopup.test.tsx` renders real query hooks with an isolated SWR cache: completing the import changes both visible lists without a reload; the test fails when invalidation is removed.
