# Agent Note: Credential exposure in diagnostic bundles

Status: implemented

English | [中文](2026-11-02-diagnostic-bundle-credential-exposure.zh.md)

## Problem

DataApi request logging included request parameters and bodies. Diagnostics-enabled builds write debug logs, and the regular `app.*.log` files are included in diagnostic bundles. The built-in scan only read `app-error.*.log`, so a provider key in a request body could be bundled without a finding.

## Decision

DataApi request logs retain only the method, path, and request ID. The bundle scan also checks staged regular application logs for credential-shaped values, including provider keys, bearer tokens, and private-key headers. Finding excerpts pass through secret redaction before they enter the report.

## Alternatives considered

- Keep request contents and rely on the scan: rejected because the secret would remain in the log and archive even when detected.
- Redact selected request fields: rejected because future request fields and parameter names may carry credentials.
- Redact every diagnostic log in the bundle: rejected because bundles are intentionally unredacted and a finding is the guard that alerts users before sharing.

## Consequences

Request logs no longer expose payload details, but retain enough information to correlate a request with its completion. A credential already present in an older regular application log can still appear in the archive; the scan reports it without copying the value into findings so users can review and rotate it before sharing.

## Verification

- Regression — `pnpm test:main src/main/data/api/core/__tests__/MiddlewareEngine.test.ts src/main/services/diagnostics/scan/__tests__/engine.test.ts src/main/services/diagnostics/scan/__tests__/rules.fixtures.test.ts src/main/services/diagnostics/__tests__/DiagnosticBundleService.scan.test.ts`: request payloads are absent from DataApi debug calls, secret fixtures match/reject as intended, and regular app logs produce a redacted credential finding.
