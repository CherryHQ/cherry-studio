# Agent Note: Upload native crash dumps through Sentry

Status: implemented

English | [中文](2026-11-15-sentry-native-crashes.zh.md)

## Problem

Crashpad stores native crash dumps locally, but Sentry excludes native reporting and diagnostic bundles contain only a dump inventory. A main-process crash can therefore leave no remote crash stack, especially when the user does not submit a diagnostic bundle.

## Decision

Install the existing SDK's `sentryMinidumpIntegration` in `ErrorReportingService.onInit`, after its `PreferenceService` dependency is ready. Keep the early local Crashpad collector. Main-process dumps upload on the next launch; renderer and child-process dumps upload when the SDK observes their termination. Use the existing data-collection and current-policy consent checks at event processing and transport, without a separate option or prompt.

## Alternatives considered

- Adding dump attachments to diagnostic bundles still depends on a manual report.
- Installing the integration during preboot scans and deletes pending dumps before the consent gate can read preferences, losing startup crash reports.
- Using the native Electron uploader bypasses the existing Sentry event and transport consent checks.

## Consequences

The SDK owns dump discovery, parsing, deletion and its ten-dump session limit. Binary dumps may contain process memory; JSON event redaction does not sanitize them. Uploads remain disabled in development and when data collection is disabled or the accepted policy is outdated. Failed uploads are not queued for offline retry by the existing transport.

## Verification

- Regression — `pnpm test:main src/main/services/errorReporting/__tests__/sentry.test.ts src/main/services/errorReporting/__tests__/sentryLog.test.ts src/main/core/logger/__tests__/LoggerService.test.ts src/main/core/preboot/__tests__/crashTelemetry.test.ts --maxWorkers=1`: 150 tests passed, including binary minidump envelope consent and revocation.
- Regression — macOS arm64 Electron 45.2.2 and Sentry 7.18.0 harness: a real main-process crash produces a dump that survives the preboot wait, then the production reporting service sends a 1,317,664-byte `event.minidump` attachment through the real SDK transport to a local HTTP receiver after preferences become ready. The event is native/fatal and identifies the browser process and application release. The harness isolates preferences and suppresses OS crash dialogs; Windows, full packaged startup and production Sentry ingestion are not verified.
- Regression — the same harness uploads a 618,960-byte renderer dump, keeps one native listener after a service restart, and sends no recovered dump when data collection is disabled or the accepted policy is outdated.
