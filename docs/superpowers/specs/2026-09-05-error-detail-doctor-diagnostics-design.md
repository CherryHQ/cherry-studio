# Error Detail Doctor Diagnostics Integration Design

Date: 2026-09-05

Status: Approved for implementation planning

## Context

The error-detail popup currently presents the complete error payload immediately and exposes Copy, Report Problem, and AI Diagnosis as peer footer actions. Doctor diagnostics live in a separate popup with their own controller, shared run state, result projection, grouped checks, evidence, fixes, and navigation actions.

This change combines those existing frontend experiences into one error-diagnostics overview without changing either AI diagnosis or Doctor backend behavior. The result should preserve the diagnostic progression: understand the current error, inspect automated findings, act on relevant checks, and report the problem only when needed.

## Goals

- Present a compact basic-information card before the diagnostic list.
- Move the existing error copy behavior into that card and keep its output unchanged.
- Offer the complete original error details as an internal page of the same popup.
- Run and display the existing AI diagnosis as a supplemental diagnostic row.
- Run and display Doctor basic checks in the same list, with an explicit network-and-services trigger in the section header.
- Keep only Report Problem as the popup footer action when reporting is available.
- Preserve existing Doctor run, result, fix, evidence, navigation, and multi-window semantics.

## Non-goals

- No backend, main-process, IPC, shared-contract, persistence, or AI diagnosis service changes.
- No synthetic Doctor check, check ID, result, or optimistic result mutation.
- AI diagnosis is not added to `DOCTOR_CHECK_CATALOG`, Doctor statistics, or `doctor.state`.
- Doctor results are not added to diagnostic bundles or problem descriptions.
- The existing safe problem-description projection is not broadened.
- The existing error copy formatter does not gain a new whitelist or include AI or Doctor output.
- No nested dialog is introduced for page navigation. Existing fix and evidence confirmations remain child dialogs
  because they are independent confirmation interactions.
- No global provider, context, store, or event bus is introduced.

## Existing Repository Practices to Reuse

- Error details already use `copyErrorDetails` with `formatAiSdkError`, `formatError`, and `safeToString`. This remains the sole copy path.
- Problem reporting already uses `buildDiagnosticReportDescription` to project confirmed safe fields into a bounded description. It remains independent from copied details and diagnostic results.
- `AiDiagnosisSection` owns the existing AI request, cached-result, error, retry, and unmount behavior. Its service call and persistence behavior remain unchanged.
- `useDoctorController` observes shared `doctor.state` and delegates run, cancel, fix, and action behavior to the existing IPC contracts.
- `DoctorChecksPanel` already implements grouped results, evidence, fixes, confirmations, and closed-set action handling. The integrated view reuses a narrow extracted renderer component instead of creating a second state machine.
- Dedicated multi-page dialogs in the repository keep their active page and dynamic header in the same component.
  `DoctorDialog` and `ProviderApiSetupDialog` place a contextual back action directly before `DialogTitle`.
- `ContentPopup` provides a static title and arbitrary body content. Because its body cannot control the header without
  broadening the shared API, the error-detail flow uses a dedicated `createPopup` Dialog while preserving the existing
  `showErrorDetailPopup(...)` caller API and popup single-flight behavior.

## Information Architecture

The error-detail popup has two internal views.

### Diagnostic overview

The overview is the default view and contains, in order:

1. A gray basic-information card.
2. A diagnostics section containing the AI supplemental row and Doctor results.
3. An optional footer containing only Report Problem.

### Full error details

View Details replaces the overview content inside the same popup. It renders the existing complete
`renderErrorDetails(error)` output without transforming or truncating it. On this page, the single Dialog header shows
an icon-only Back to Diagnostic Overview action immediately before the Error Details title. The action has a localized
accessible name and tooltip. The details body contains no second back action or repeated Error Details heading.

The overview host, AI diagnosis state, and Doctor controller stay mounted while the full-details page is visible. Switching views therefore does not stop AI diagnosis, cancel Doctor, or lose a result received while viewing details.

The dedicated error-detail popup owns the `activeView` state because it also owns `DialogHeader`. Entering the details
page moves focus to the header title; returning to the overview restores focus to the View Details action. A page switch
changes presentation only and never resolves or closes the popup.

## Basic Information Card

The card uses the established secondary/neutral surface, semantic border, and repository spacing. Its header shows Basic Information on the left and two text-style actions on the right:

- Copy: calls the current `copyErrorDetails` implementation. The copied text contains only the same error representation copied by the existing popup. It never includes AI diagnosis or Doctor findings.
- View Details: switches to the internal full-error-details view.

The compact body shows only fields available on the current error:

- Location
- Provider
- Model
- Error type or name
- Status code
- Error message

Missing optional fields are omitted instead of rendered as placeholders. Long values wrap without forcing the popup wider.

## Diagnostics Section

The section header shows System Diagnostics on the left and Network and Services Check on the right. The network action is secondary to the findings and is not placed in the popup footer.

The body uses the approved grouped-accordion layout:

- AI Diagnosis is the first supplemental row.
- Doctor checks follow in their existing domain groups.
- Groups containing anomalies are expanded initially.
- Groups containing only normal results are collapsed initially.
- Doctor evidence and available row actions remain accessible through the reused result renderer.

AI diagnosis is visually aligned with Doctor rows but remains a separate frontend-only item. It does not change the 26-item Doctor catalog, Doctor counts, Doctor summary, or Doctor report.

## Run and State Behavior

### AI diagnosis

- If a cached AI diagnosis exists, show it as completed and do not request it again.
- If no cached diagnosis exists, opening the error-detail overview starts the existing AI diagnosis flow automatically.
- Loading, success, failure, and retry continue to use the existing AI component behavior.
- Doctor execution and AI execution are independent and may run concurrently.

### Doctor basic checks

- When the popup opens without an active Doctor run, request a basic check run.
- When any Doctor run is already active, observe the shared run and do not start, replace, or cancel it.
- Results and progress are derived from shared `doctor.state`; the popup does not maintain its own copy of backend results.
- Closing the error-detail popup does not cancel Doctor.

### Network and services checks

- The section-header action requests the existing live run tier.
- A live request starts a new authoritative run with a new `runId` and an initially empty result list. The backend selects
  both catalog tiers (`quick` and `live`), so all basic checks run again before or alongside the additional network and
  service checks. It does not extend or reuse results from the previous basic report.
- While a Doctor run is active, the action displays progress and prevents a duplicate request.
- After the live run begins, the same grouped list expands to the actual results returned from the 26-item catalog; no placeholder rows are generated.
- The user-visible labels remain Basic Check and Network and Services Check; internal tier values are never exposed.

## Doctor Row Actions

The integrated list preserves the existing exhaustive Doctor action handling and fix confirmation behavior. Navigation closes the error-detail popup before handing off to Settings. Fixes continue through `diagnostics.doctor.fix` with the authoritative run and check identifiers. No action is inferred from a check ID when the backend did not return it.

The standalone Doctor popup keeps its public API and continues to use the same extracted grouped-results component. The extraction must not create a second controller or duplicate the diagnostic state machine.

## Footer and Problem Reporting

Copy and AI Diagnosis are removed from the footer. When the existing caller provides problem-report capability, the footer contains only Report Problem. When reporting is unavailable, no substitute footer action is added; the standard close affordance remains available.

Report Problem continues to prefill only `buildDiagnosticReportDescription(error)`. It does not append the AI diagnosis, Doctor report, Doctor evidence, or the complete copied error text.

## Error and Edge Cases

- AI diagnosis failure appears on the AI row and offers its existing retry behavior; it does not mark a Doctor check as failed.
- Doctor `error` and `skip` outcomes retain their unfinished semantics and are not counted as user problems.
- A Doctor run owned by another window remains shared and observable; this popup does not assume ownership.
- Stale, canceled, or busy Doctor results follow the existing controller and ViewModel behavior.
- Switching to full details during either run changes presentation only.
- Closing the popup preserves existing AI unmount semantics and leaves Doctor execution untouched.

## Visual and Accessibility Requirements

- Use `@cherrystudio/ui` primitives and Tailwind classes only.
- Use semantic neutral, status, and destructive styles defined by `DESIGN.md`.
- Use responsive wrapping for card actions and long metadata values.
- Loading indicators honor reduced-motion preferences.
- Accordion triggers, copy, view switch, retry, network run, row actions, back, and report remain keyboard accessible and have localized accessible names.
- All user-visible strings are i18next resources in every renderer locale.

## Verification Strategy

Behavior-focused renderer tests should demonstrate:

- the compact basic fields are shown and Copy produces the same output as before;
- View Details and Back switch internal views without unmounting the diagnostic hosts or canceling Doctor;
- the details page places its Back action in the Dialog header before the sole Error Details title, with no duplicate
  heading or back action in the body;
- uncached AI diagnosis and Doctor basic checks start concurrently;
- cached AI results are displayed without a duplicate request;
- an already-running Doctor execution is observed without a duplicate run;
- Network and Services Check starts a fresh live run, re-runs quick checks, and displays only actual catalog results;
- AI output is excluded from Doctor counts, copied error details, and problem-report prefill;
- the footer exposes only Report Problem when reporting is supported;
- Doctor row actions and fix confirmations retain their observable behavior.

Run only the directly affected renderer Vitest files during implementation, followed by one final `pnpm lint`. Full renderer tests and builds remain outside this Draft implementation stage.
