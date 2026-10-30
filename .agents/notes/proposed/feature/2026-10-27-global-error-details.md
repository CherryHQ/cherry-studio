# Agent Note: Global error details, diagnosis, and update actions

Status: proposed

English | [中文](2026-10-27-global-error-details.zh.md)

## Problem

Chat and Agent errors can open error details, run Doctor, and report a problem. Failures from paintings, files, settings, auxiliary windows, and startup cannot: they show a toast or dialog that loses the failed operation and its technical cause. Diagnostic reports do not consistently carry the failure context or the matching AI analysis. An outdated client has no update entry where the error is shown, and early startup failures have no supported way to give feedback or export diagnostics.

## Proposal

- Every user-facing failure can carry an occurrence snapshot (`AppErrorContext`): its own ID, time, source, operation, and optional provider, model, and record. Toasts, promise failures, error dialogs, inline errors, and render or window fallbacks can open one shared error detail while keeping their recovery actions and the original cause.
- Doctor and AI consultation accept an operation incident in addition to a conversation. Image-only models skip chat probes; model-free operations run only the applicable system checks. Consultation discloses what it reads: an operation incident reads that error context and its diagnostics, a failed message reads that conversation.
- Diagnostic upload and export add `error-context.json` and, when a matching AI analysis exists for the same fault, `ai-diagnosis.json`. Retries keep the snapshot. No additional database or image-attachment collection is introduced.
- Error details and About share one update state: channel-aware checks, progress, and installation confirmation. Lightweight windows hand the check off to the main window. A withheld feed is never reported as up to date.
- Startup, migration, relocation, data-reset, and renderer-crash failures keep localized copy, feedback, export, and an official-download fallback when the normal UI and services are unavailable.
- Application-authored messages use the locale catalogs. Raw external errors and stacks stay diagnostic evidence. Reporting and installation remain user-triggered.

## Alternatives considered

- Keep diagnosis limited to conversations: rejected because other visible failures stay without useful context.
- Build separate diagnostic systems for paintings and files: rejected; the existing Doctor, report packaging, and updater flows are reused with an occurrence snapshot.
- Upload a report or install an update automatically: rejected because it bypasses the user's choice.
- Reuse the conversation disclosure for operation incidents: rejected because it describes data the analysis does not read.

## Acceptance criteria

- AC1 — Toasts, promise failures, error dialogs, inline errors, and render or window fallbacks can open the shared error detail without losing recovery actions or the original technical cause. (verification: renderer)
- AC2 — Each occurrence carries its own ID, time, source, and operation; Doctor analyzes a non-conversation operation, image-only models skip chat probes, and model-free operations run only applicable system checks. (verification: unit + renderer)
- AC3 — Diagnostic upload and export include `error-context.json`, plus `ai-diagnosis.json` only when a matching analysis exists for the same fault; retries keep the snapshot and no database or image attachment is added. (verification: unit)
- AC4 — AI consultation for an operation discloses that it reads the error context and diagnostics, a failed message discloses the conversation, and with no incident neither sentence is shown. (verification: renderer)
- AC5 — A verified provider HTTP 5xx hides only the direct report button; AI consultation can still hand off a report, and non-5xx errors stay reportable. (verification: renderer)
- AC6 — Error details and About share update state, channel-aware checks, progress, and installation confirmation; lightweight windows hand off to the main window, and a withheld feed is never shown as up to date. (verification: unit + renderer)
- AC7 — Startup, migration, relocation, data-reset, and renderer-crash failures offer localized copy, feedback, export, and an official-download fallback without the normal UI. (verification: unit + Electron)
- AC8 — Application-authored error messages come from the locale catalogs, raw external errors stay diagnostic evidence, and reporting and installation happen only on a user action. (verification: unit + docs gate)

## Risks

- The shared toast primitive and popup host change for every caller; verify existing toasts, confirms, and focus behavior across windows.
- Native dialogs, startup message boxes, migration and relocation windows, diagnostic upload, and update installation need Electron or packaged verification that unit tests cannot provide.
- Failures inside diagnosis, reporting, or updating must stay local and retryable instead of recursively opening error details.
