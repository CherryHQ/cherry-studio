# Agent Note: Scope feedback status refreshes to the active history view

Status: implemented

English | [中文](2026-11-27-feedback-refresh-lifecycle.zh.md)

## Problem

A diagnostic-history refresh can outlive the dialog opening that started it. If it fails after the dialog is reopened, it can show an obsolete warning and enable pagination while the new refresh is still running.

## Decision

The effect for the active dialog opening and visible report IDs owns the refresh warning and pagination state. Cleanup retires that effect. Earlier refreshes can finish in Main and update the report cache, while only the current effect can complete the dialog refresh.

## Alternatives considered

- Sharing one in-flight request across openings would couple the reopened view to an earlier refresh and defer an immediate recheck.

## Consequences

Reopening history starts a fresh status check for the visible reports. A current request failure still shows the existing warning and keeps the last known statuses available.

## Verification

- Regression — `src/renderer/components/feedback/__tests__/DiagnosticHistoryDialog.test.tsx`: delays two requests across a close and reopen and verifies that the old failure neither shows a warning nor enables pagination.
