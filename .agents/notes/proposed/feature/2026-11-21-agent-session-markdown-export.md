# Agent Note: Incremental Markdown file export for Agent sessions

Status: proposed

English | [中文](2026-11-21-agent-session-markdown-export.zh.md)

## Problem

A user measured 303 MB of stored data in a 398-message Agent session while investigating slow session loads. To export such a session, Cherry Studio currently collects every message page in the renderer, converts the messages concurrently and assembles the entire Markdown string. With no configured export directory, the save dialog opens after all that work. A user who dismisses it has already paid the full cost. The reported size measures stored input. Peak memory during file export still needs to be measured. [Session-size report](https://github.com/CherryHQ/cherry-studio/issues/24555) · [Export tracking issue](https://github.com/CherryHQ/cherry-studio/issues/25052)

## Proposal

Apply this workflow to the two Agent session menu actions that save a local Markdown file, including the option to export reasoning.

1. Resolve the destination before reading the first page. With a configured Markdown export directory, keep the existing timestamped filename. Otherwise, ask the main process to show the native save dialog in the invoking window. Choosing a path leaves its contents intact until the export succeeds.
2. Capture the active branch head when reading begins. Read that branch in chronological batches up to the captured head. Release each batch's message payload after writing it. Carry forward the citation information needed for a later answer to refer to an earlier search result. Keep the existing Markdown formatting, reasoning and citation settings, and model attribution.
3. Show progress as messages are processed and offer cancellation while the export is running. Stage output in the destination directory. Publish the finished file only after the last write succeeds. Cancellation or failure releases the staged output and allows another export.

## Alternatives considered

- Opening the existing save dialog with an empty string would create or truncate the selected file before the session had been read. Separating selection from writing preserves an existing export if a later page fails.
- Paginating the database request alone still leaves all pages resident when the renderer joins them. Writing batches also removes the need for a second, complete Markdown string.
- Limiting the export to recent messages would omit earlier turns and sources needed to archive the session.

## Acceptance criteria

- AC1 — Dismiss the save dialog with no configured export directory. The exporter requests zero session-message pages and creates no file. With a configured directory, one export produces a timestamped Markdown file without a prompt. (verification: renderer export tests and desktop save-dialog check)
- AC2 — Export a multi-page fixture with an early source cited on a later page. The file matches the existing Markdown output byte for byte for each reasoning option and citation setting, including the first and last messages in order. An unselected sibling and a turn appended after reading began both stay out of the file. (verification: renderer export integration tests)
- AC3 — Compare exports of two synthetic sessions with a tenfold difference in page count and the same maximum message size and citation count. Record peak renderer memory for the existing and proposed paths. Instrument page reads and writes to verify that a completed batch releases its message payload and that writes begin before the final page is read. (verification: export integration tests and desktop memory profile)
- AC4 — Observe progress advance and use the visible cancel action after at least one batch has been written. Separately inject a later read or write failure. Each operation stops scheduling further pages, preserves the original destination bytes, and removes its temporary file. A subsequent export succeeds. (verification: main-process file tests and desktop cancellation check)

## Risks

The current session cursor walks from newest to oldest and resolves the active head on each page. A forward reader must preserve the selected branch and stop at the captured head. A long session can contain a single large tool result, and a later answer can cite the first turn. Report maximum message size and citation count alongside the memory profile so the effect of batching is visible. Use the existing file-write protections for both staging and publication. Verify replacement of an existing file on supported desktop platforms, where open-file handling differs.
