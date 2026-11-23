# Agent Note: Scope problem-report chat attachments to the errored conversation

Status: implemented

English | [中文](2026-11-20-problem-report-chat-consent.zh.md)

## Problem

Submitting an ordinary problem report could attach chat history from unrelated conversations in the last 24 hours.

## Decision

Omit chat history from ordinary reports. From a message error, offer an unchecked option to attach the affected conversation's last 24 hours. The upload request carries the selected topic ID only after opt-in, and the main process restricts collection to that topic or Agent session.

## Alternatives considered

- Offering an opt-in for all recent conversations would still expose unrelated messages.

## Consequences

Logs and traces remain diagnostic sources. Local diagnostic exports retain their own source selection.

## Verification

- Regression — `DiagnosticBundleService.test.ts` verifies archive contents for both conversation types, and the renderer tests verify the opt-in and error-report handoff.
