# Agent Note: Preserve Claude Code exit capture evidence without exposing stderr

Status: implemented

English | [中文](2026-11-07-claude-code-exit-capture-visibility.zh.md)

## Problem

Issue #23676 reports a Claude Code process exiting with code 3 while Work displays a generic error. The logs establish the process exit, diagnostic reference, and unresolved classification. They do not establish whether the captured stderr tail was empty or contained text that the classifier did not recognise. The triage claim that stderr was "evidently empty" is therefore not established.

The captured tail can contain private paths, credentials, or other user content. An unresolved classification is insufficient evidence to disclose it, and code 3 has no documented meaning that establishes the underlying cause.

## Decision

Main records a content-free `stderrCaptured` boolean from the trimmed tail used for classification. The process-failure log carries that boolean; the normalized error carries `processStderrCaptured` through serialization and IPC; the renderer exposes it as `stderrCaptured`. The raw tail remains internal to process diagnostics and classification, outside the normalized error, logs, and IPC payload.

Only an unresolved Claude Code exit with category `unknown`, numeric code 3, a non-empty diagnostic reference, and an explicit boolean receives the process-specific heading. Its description retains the code and reference and distinguishes no captured non-empty output from captured output whose cause could not be identified. This states capture evidence, not the meaning of code 3. Both descriptions advise reviewing completed work before retrying and reporting the code and reference if the failure recurs.

The unresolved description has no three-line clamp so that the evidence and recovery guidance remain readable. Recognised-category descriptions retain their existing clamp and headings.

## Alternatives considered

- Log a sanitised stderr tail: rejected because no sanitizer is provably safe for arbitrary diagnostic text. `redactSecretText` leaves private paths and standalone tokens; a field named `stderrTail` is not automatically sanitised by the central logger.
- Generalise the heading and capture guidance to every unresolved exit: deferred because that requires a separate scope decision.
- Invent a specific meaning for exit 3: rejected because there is no documented exit-code contract establishing it.
- Keep capture evidence log-only: rejected because the generic UI reported in #23676 would remain.

## Consequences

Legacy payloads without the boolean retain the generic heading. Codes 1 and 3221226505, spawn failures, and recognised auth/quota/MCP categories retain their existing presentation and navigation. The boolean describes the captured trimmed tail, not a guarantee that the child emitted no stderr or that its complete output was captured.

#22418 owns session-id, fingerprint, and reset behaviour; this repair does not change those decisions. The locale translations and this Chinese note are machine-written and need native-speaker review.

## Verification

The counts below come from saved runs in `round-1`; they were inspected during this follow-up, not rerun by its author.

- Regression — `processExitDiagnostics.test.ts`, `ClaudeCodeProcessManager.test.ts`, and `serializeError.test.ts`: saved main RED has 9 failed and 50 passed across 3 files; saved GREEN has all 59 passed across the same 3 files. These cover capture-state propagation, process logging, serialization, reset, and privacy.
- Regression — `errorClassifier.test.ts` and `ErrorBlock.test.tsx`: saved renderer RED has 4 failed and 174 passed across 2 files; saved GREEN has all 178 passed across the same 2 files. These cover the strict unresolved predicate, legacy/other-code controls, headings, evidence sentences, and description clamping.
- Regression — `probe/matrix.stdout.jsonl`: the saved real-module baseline exercises code-3 empty, auth, quota, MCP, and unrecognised tails; code 1; code 3221226505; spawn failure; and reference-removal negatives. It demonstrates the former generic unresolved heading and retained recognised categories without private text in serialized payloads. This is pre-fix evidence, not a post-fix matrix pass. `probe/supplement.stdout.jsonl` also records real child exits and the redaction limitations.
- Regression — `tests/e2e/smoke/claudeCodeExitDiagnostics.test.ts`: the operator's first run failed at the heading assertion because the seeded part used `error` instead of `data`; the app launched, mocked the provider, and stored the message (`PATCH` 200). After correcting the part shape, the operator recorded three passing runs of the same spec: 10.4 s, 12.2 s, and 10.6 s. All three runs covered empty-tail, unrecognised-tail, and auth-control cases, each with an attached PNG screenshot. Unresolved descriptions are unclamped and fully readable; auth retains its heading, clamp, and `Go to Settings`. The heading value was changed to `Claude Code stopped mid-turn.` to avoid repeating the description.
