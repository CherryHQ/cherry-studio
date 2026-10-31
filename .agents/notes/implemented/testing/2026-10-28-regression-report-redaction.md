# Agent Note: Redact credentials before Playwright report serialization

Status: implemented

English | [中文](2026-10-28-regression-report-redaction.zh.md)

## Problem

Playwright records password-input values in step titles even with tracing disabled. A real CODE-01 run exposed a configured provider key in its blob report. Redacting the regression verdict and masking screenshots do not sanitize these steps.

## Decision

The regression configuration places RedactionReporter before every other reporter. It uses the shared configured-secret redactor on step titles and step, test and executor errors before JSON, HTML and blob reporters serialize them. Custom reporter selections must preserve this ordering.

## Alternatives considered

- Disabling tracing does not remove step titles from blob reports.
- Sanitizing archives after a run leaves raw credentials available until that cleanup finishes.
- Removing credential-entry steps would stop testing the real provider setup flow.

## Consequences

Reports preserve failures and step structure while replacing configured credentials with redaction markers. This reporter does not sanitize application logs, arbitrary attachments or screenshot pixels; those retain their existing controls.

## Verification

- Regression — `scripts/e2e/regression/__tests__/RedactionReporter.test.ts` runs real Playwright reporters with a synthetic credential in a step title and failure, then inspects JSON, blob contents and the HTML report's embedded ZIP for the original value.
