# Agent Note: Windows selection exclusions for system screenshot hosts

Status: proposed

English | [中文](2026-11-01-windows-selection-system-screenshot.zh.md)

## Problem

The reporter of #23330 observed an A/B difference: with Selection Assistant enabled in Selected mode and Application Filter=Off, copying and pasting a Cherry reply followed by a Win+Shift+S capture leaves the screenshot unavailable for pasting; disabling the assistant restores screenshot pasting.

Source-confirmed facts: Application Filter=Off maps to `filter_mode='default'`. In Selected mode, `SelectionService.setHookGlobalFilterMode` converts default to the predefined exclusion list and merges that list with a user blacklist. The Windows Screenshot group already excludes `snipaste.exe`, `pixpin.exe`, and `sharex.exe`, but lacks `snippingtool.exe` and `screenclippinghost.exe`. A matching global exclusion exits before UIA, MSAA, or clipboard retrieval in the dependency's Windows source.

Unconfirmed Windows path: the dependency's source permits clipboard competition under some retrieval and timing conditions, but this run has not reproduced the report on Windows or identified the actual foreground process, cursor, clipboard owner, restoration, or hook path. The source alone does not establish the underlying cause.

## Proposal

Append the lowercase complete executable basenames `snippingtool.exe` and `screenclippinghost.exe` to `SELECTION_PREDEFINED_BLACKLIST.WINDOWS`, retaining all three existing screenshot entries. Reuse the existing Selected/default and Selected/blacklist wiring without preference changes. Selected/whitelist and non-Selected modes receive no additional protection from this predefined list.

Protection depends on the retrieval target resolving to one of these processes. The hook samples `GetForegroundWindow()` when processing the gesture; if the overlay has closed and focus has returned to another application, the exclusion can miss the request. This is application-wide exclusion, including automatic selection of editor/OCR text in these two applications. The native matcher lowercases names and uses substring matching; complete basenames narrow the entries but do not make matching strict equality.

## Alternatives considered

- Disable clipboard fallback only for the two applications: `setClipboardMode(EXCLUDE_LIST, ...)` exists and could retain UIA/MSAA selection. It still checks the same foreground-derived process name, so it does not close the target-identification gap, and adds another list and mode lifecycle when the repository already owns a Screenshot exclusion policy.
- Temporarily disable/enable clipboard retrieval during capture: there is no reliable connected capture-session start/end signal. A Win+Shift+S listener misses other entry points and needs cancellation and reentry handling. Configuration is snapshotted when requests are enqueued, so toggling after an event cannot retract an in-flight request.
- Change the two `SELECTION_FINETUNED_LIST` lists: `EXCLUDE_CLIPBOARD_CURSOR_DETECT` exempts applications from cursor checks and can enable fallback that a custom capture cursor would otherwise block, the opposite direction. `INCLUDE_CLIPBOARD_DELAY_READ` changes copy timing but retains clipboard clearing and restoration, without a contract to preserve concurrent writes.
- Patch native source or upgrade the dependency: the loader uses native binaries; `electron-builder.yml` discards `selection-hook/build/**` and `selection-hook/src` while retaining prebuilds. The analysis/advisor registry query reported latest as 2.1.2, matching the repository pin. A source edit alone does not deliver a changed binary; a native repair requires verified Windows builds and a distribution change beyond this scoped candidate.

## Acceptance criteria

- AC1 — The reported Selected + Application Filter=Off copy/paste then Win+Shift+S flow produces a screenshot that can be pasted normally. (verification: Windows manual acceptance, pending)
- AC2 — Text selection and the selection toolbar continue to work in ordinary applications, including a browser and Word, before and after capture. (verification: Windows manual acceptance, pending)
- AC3 — Configuration tests cover the predefined system screenshot exclusions and prevent regression of the existing third-party screenshot entries. (verification: macOS unit test `src/main/services/selection/__tests__/selectionConfig.test.ts`)

The implementation worker owns the macOS configuration, consumer, and static checks; a Windows verifier owns the pending manual acceptance. Configuration membership does not certify native filtering, screenshot pasting, or installed third-party tools.

## Risks

- Cursor heuristics, non-text selection checks, or successful UIA/MSAA retrieval may already prevent clipboard fallback. Clipboard competition remains an unconfirmed explanation for the report.
- The processing-time foreground window can belong to another application, process-name resolution can fail, and already queued retrievals are not cancelled by these entries.
- Other screenshot hosts and concurrent clipboard writers receive no general protection from these two entries.
- Automatic selection of editor/OCR text inside both excluded applications is also disabled.
- Windows and Snipping Tool versions can change process hosting and timing; the reported Windows build has not been verified here.

## Verification

- The configuration test was run on macOS against the unchanged product file: 2 failed / 3 passed, with only the two system hosts missing. After appending the entries, the same command passed all 5 tests.
- The existing `SelectionService.test.ts` and `SelectionService.voice.test.ts` consumer tests passed: 2 files, 14 tests. Their mocked platforms do not verify Windows capture behavior.
- The required node typecheck exhausted the default heap (exit 134). A retry with an 8 GB heap reported only baseline TS2307 at `tests/helpers/piGateway.ts:25`, for the unavailable `@cherrystudio/agent-runtime-pi` module (exit 2).
- Scoped Oxlint, ESLint, Oxfmt, and `git diff --check` passed. The repository Agent Note format and bilingual pairing gates pass with this note installed.

Windows acceptance pending; the underlying clipboard competition is not confirmed.
