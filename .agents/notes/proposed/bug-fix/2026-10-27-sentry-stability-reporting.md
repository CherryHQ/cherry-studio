# Agent Note: Sentry application stability reporting

Status: proposed

English | [中文](2026-10-27-sentry-stability-reporting.zh.md)

## Problem

Automatically uploading error logs spends the shared Sentry quota on recoverable network and business failures. One DataApi failure can also be logged at multiple boundaries. These reports crowd out application failures and the mobile project's events. Local logs and user-initiated in-app feedback already serve operational troubleshooting.

## Proposal

Separate logging from telemetry. Ordinary logs, including `logger.error`, remain local and available to feedback. Sentry accepts unexpected unhandled exceptions, handled internal DataApi failures, explicitly reported render failures, fatal startup failures, and Electron process crash summaries. Being caught does not make an application failure expected; being unhandled does not make a network failure actionable.

Use the main SDK's sending hook as the common policy boundary for main and renderer events. Filter known cancellation and transport failures from automatic non-fatal reports. Explicit startup/render failures and fatal exceptions remain eligible even when their cause resembles a transient error. Do not suppress all `NOT_FOUND` errors: normal handled requests stop uploading when the log bridge is removed, while unexpected unhandled failures remain visible.

At the DataApi catch boundary, emit the original error once for `INTERNAL_SERVER_ERROR` or `DATA_INCONSISTENT`. The telemetry service subscribes after DataApi initialization; the data layer has no Sentry dependency. These explicit handled reports retain stack/cause information and share the unexpected-exception budget and operational-noise filtering. Other handled request errors remain local. The shared and file-preview error boundaries both report caught render failures while keeping their existing fallback UI.

Deduplicate a normalized error signature for ten minutes across windows. Retain separate hourly budgets of ten application-fatal/render/startup events and ten other unexpected exceptions per running app. Keep bounded in-memory state, preserve the first accepted sample, and leave local logs unchanged. Do not apply random sampling.

Reuse Electron SDK process-exit detection without enabling breadcrumbs, child command arguments, or native-memory attachments. Observe fail-fast service initialization failures and main-window initialization failures through existing lifecycle events, without changing the main window's graceful error strategy; an unexpected error escaping startup gets a bounded flush before exit. Preserve consent, policy-version checks, redaction, and development-mode exclusion. Before consent can be read, failures remain local; main-process native dumps also remain local for diagnostics. No new consent cache or offline upload queue is introduced.

## Alternatives considered

- Server-side limits: unavailable on the current plan and do not establish which application events are worth reporting.
- Keep the log bridge and extend a denylist: every new business error would remain opted in by default.
- Random sampling alone: retains low-value noise while losing the first useful sample of a new fault.
- Globally ignore `NOT_FOUND` or every network-looking error: hides state bugs and startup failures.
- Upload native memory or persist pre-consent events: expands collection beyond the existing consent and diagnostic boundary.

## Acceptance criteria

- AC1 — Ordinary main and renderer error logs remain usable without producing Sentry events. (verification: unit; owner: maintainer)
- AC2 — Unexpected unhandled exceptions, caught internal DataApi failures, shared and file-preview render failures, main-window and fail-fast service initialization failures, and supported Electron process crash summaries are eligible for reporting. (verification: unit and Electron; owner: maintainer)
- AC3 — Automatic cancellation/transport noise is discarded without discarding explicit application failures or unknown errors. (verification: unit; owner: maintainer)
- AC4 — Interleaved duplicates and changing UUIDs cannot bypass the ten-minute window, and one event class cannot consume the other class's hourly budget. (verification: unit; owner: maintainer)
- AC5 — Development mode, missing/revoked/outdated consent, redaction, and the absence of native-memory uploads retain their existing guarantees. (verification: unit and Electron; owner: maintainer)

## Risks

Changes apply only to upgraded clients. Per-installation budgets do not guarantee an organization-wide quota. Session-only deduplication resets on app restart. Startup failures before preferences are readable cannot be uploaded automatically under the existing consent model. Native main-process crashes are available through local diagnostic dumps, not automatically uploaded memory. The owner requested implementation of this boundary in the current conversation; no GitHub Spec approval or executed runtime verification is claimed here. Tests and builds remain user-owned.
