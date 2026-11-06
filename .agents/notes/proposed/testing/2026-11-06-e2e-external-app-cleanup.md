# Agent Note: Close external applications opened by regression tests

Status: proposed

English | [中文](2026-11-06-e2e-external-app-cleanup.zh.md)

## Problem

Regression scenarios open native applications outside the controller-owned Cherry Studio process. Several scenarios leave Preview documents, browser tabs, terminal sessions, file-manager windows or System Settings open. Repeated runs accumulate desktop state, including when the scenario passes. Closing the recorded application process does not establish that these external resources have closed.

The existing [fixture](../../../../tests/e2e/regression/fixture.ts) cleans transient Cherry Studio UI. The final [controller cleanup](../../../../scripts/e2e/regression/cli.ts) stops its application and mock service. Neither currently owns all external resources opened by scenarios.

## Proposal

Keep external-resource ownership in the [regression controller](../../../../scripts/e2e/regression/README.md), with explicit registration around scenario launch actions. This change affects test infrastructure and scenarios only; normal product launch behavior stays unchanged.

Before dispatching a launch, persist its intent, the target path or unique URL, and the relevant application baseline under the run's private directory. Reconcile the resulting document, tab, window and process identities after dispatch. Keep enough information to retry cleanup if launch verification or the test executor fails between those steps; a PID or a process name alone is not ownership evidence.

Record process start identity alongside its PID, plus document paths, window identifiers or exact browser-tab URLs as appropriate. A baseline describes pre-existing resources, but a newly observed resource still needs a link to the registered launch. Do not infer ownership merely because a window or process appeared during the test.

At case teardown, close registered documents, tabs, windows and CLI sessions on success, assertion failure and timeout. Wait for disappearance. Continue attempting independent resources after a cleanup error, retain unresolved records for retry, and fail cleanup with the remaining resource identities and reasons. Collect failure evidence before closing external resources; redact URLs and commands in reports when they contain credentials.

For applications started by the test, request normal exit once their test resources have closed. After a bounded wait, force termination only when the recorded process identity still matches and no unrelated resources are present. Revalidate immediately before termination and verify exit afterward. Preserve applications already running before the test and their existing or unrelated content. Finder and Explorer receive window-level cleanup only; never terminate their shared desktop process. If ownership or the absence of unrelated content cannot be established, report unresolved cleanup instead of killing the process.

Final controller cleanup retries persisted records even when the executor has exited or application/mock-service cleanup fails. Cleanup must not require a live Electron inspector. Repeated cleanup is idempotent for already-closed resources. A hard kill or host shutdown can prevent cleanup code from running; persisted records support a later cleanup attempt, not immediate recovery without an executor.

### Scenario coverage

| Scenario or helper | External resource | Required cleanup |
| --- | --- | --- |
| Registered Code Mate CLI launch scenarios | Terminal/command windows and CLI sessions | Close the test session/window; exit a test-started terminal when it has no unrelated content |
| MP-41 | System-browser HTML tab | Close the tab by its run-unique identity; exit a test-started browser only when no unrelated content is present |
| MP-70, MP-114 | Finder/Explorer reveal windows | Close windows created for the registered reveal action; preserve existing windows |
| MP-77 | Preview PDF and Pages Word | Close test documents on success and failure; exit applications started by the test when safe |
| MP-90 | Preview image or isolated Edge browser | Close the test document/browser and verify the existing Windows browser cleanup |
| MP-140 | System Settings permission window | Close the test-created window; exit a test-started settings application when safe |
| MP-97 | Terminal permission-verification sessions | Retain launch ownership when window discovery fails and verify session/window closure |
| openExternalText/closeExternalText callers | TextEdit or Windows selection browser | Close test documents; exit applications started by the test when safe; report remaining resources |

The CODE-02 removal in [PR #23723](https://github.com/CherryHQ/cherry-studio/pull/23723) remains separate. Implementation covers registered scenarios at its verified base without restoring removed tests. Existing scenarios must continue exercising real external launches rather than replacing product actions with successful mocks. Unsupported native cleanup must fail with an explicit reason rather than silently bypassing the scenario.

## Alternatives considered

- Add unrelated close commands to each scenario: smaller individual edits, but no shared ownership checks or recovery after executor exit.
- Kill applications by name after a run: simple, but can discard user documents and terminate unrelated processes.
- Register owned resources and clean them at case and controller boundaries: chosen because retry, preservation and actual closure can be verified together.

## Acceptance criteria

- AC1 — On success, assertion failure and timeout, teardown closes registered test documents, tabs, windows and CLI sessions and verifies their disappearance. (verification: unit and Electron; owner: regression external-resource cleanup and affected scenarios)
- AC2 — Test-started independent applications exit normally; a controlled unresponsive process is force-terminated only after ownership revalidation and absence of unrelated content, with exit verified. (verification: unit with real child processes and platform desktop acceptance; owner: native cleanup adapters)
- AC3 — Pre-existing applications, existing or unrelated content, shared file-manager processes and reused PIDs are preserved; uncertain ownership is reported as unresolved cleanup. (verification: unit and platform desktop acceptance; owner: ownership checks and native cleanup adapters)
- AC4 — One cleanup failure does not prevent other resources from being attempted; unresolved records survive and a retry can complete without hiding the original scenario failure. (verification: unit; owner: cleanup coordinator and reporting)
- AC5 — After executor exit or failure between launch and identity reconciliation, final cleanup can recover registered resources from private run records without Electron; repeated cleanup tolerates already-closed resources, and other cleanup failures do not bypass it. (verification: unit with real record files and child processes, plus platform desktop acceptance; owner: launch registration and controller cleanup)
- AC6 — macOS and Windows desktop evidence demonstrates the covered external launches, closure, exit where applicable and preservation of pre-existing content; unit tests and Playwright enumeration alone do not establish desktop acceptance. (verification: Electron and platform desktop acceptance; owner: affected scenarios and hosted regression workflow)

## Risks

Native automation may fail because of permissions, confirmation dialogs or platform-specific application behavior. The implementation must expose those failures and retain cleanup records rather than broadly killing processes or claiming success. Resource identifiers may become stale after application restart; identity checks must distinguish an absent resource from an unrelated replacement.

An application can acquire unrelated content after the test launches it. That prevents process termination even when the process was initially test-started; close only owned content and report any remaining cleanup limitation. A system browser can reuse an existing window, so tab identity must be preserved separately from process ownership.

Validation uses explicit affected test paths, real record files and controllable child processes for cleanup contracts, E2E typechecking, changed-file lint/format checks and manifest/discovery consistency. Real macOS and Windows runs remain required for native document, tab and window behavior. This Spec does not claim that either desktop acceptance has run.
