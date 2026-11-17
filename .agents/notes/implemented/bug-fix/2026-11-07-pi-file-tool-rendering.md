# Agent Note: Render native Pi file tool arguments

Status: implemented

English | [中文](2026-11-07-pi-file-tool-rendering.zh.md)

## Problem

Regression MP-51 approved a real Pi write and verified the resulting bytes on disk, but its completed tool card had no file link. The renderer mapped Pi's `write` name to the shared `Write` card while leaving its native `path` argument unchanged. The shared file cards require `file_path`; Edit also requires `old_string` and `new_string` instead of Pi's `oldText` and `newText`.

## Decision

Adapt object arguments for Pi Read, Write and Edit at the existing tool-response presentation boundary. Preserve the native fields and add the shared card fields. Keep persisted messages and runtime execution inputs unchanged. Native Pi edits containing an `edits` array use the existing MultiEdit card, with every hunk converted independently; the older single-hunk shape continues to use Edit.

## Alternatives considered

- Changing runtime inputs would alter the SDK contract and recorded execution evidence.
- Adding Pi-specific branches to every file card would duplicate the same adapter across consumers.
- Removing the E2E file-link assertion would hide a real navigation failure.

## Consequences

Completed Pi file cards can display file links and edit diffs using the existing shared components. Other transports and unrelated tools retain their argument shapes. This does not introduce another execution or persistence format.

## Verification

- Regression — native Read, Write and Edit inputs must provide the shared card's path and diff fields without mutating the original input; untagged tools remain unchanged. All three cases failed before the fix.
- Regression — 88 tests passed across the tool-response adapter, shared Agent tool renderer and execution timeline files.

- Regression — MP-52 exposed native `edits: [{ oldText, newText }]` inputs. A two-hunk adapter test failed before the follow-up and verifies every hunk plus unchanged stored arguments.

- Regression — MP-52 passed against the real provider and Pi runtime: rendered edit hunks, unchanged unrelated files, fresh preview contents and TextEdit clipboard contents matched the edited file.
