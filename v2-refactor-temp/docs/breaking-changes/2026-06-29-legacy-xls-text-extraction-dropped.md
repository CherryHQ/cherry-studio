---
title: Legacy .xls text extraction is no longer supported
category: changed
severity: notice
introduced_in_pr: #16552
date: 2026-06-29
---

## What changed

The Office text extractor was upgraded from officeparser 4 to 7, which dropped support for the legacy binary `.xls` format. Modern formats (`.docx`, `.xlsx`, `.pptx`, `.odt`, `.odp`, `.ods`) and `.doc` (via word-extractor) are unaffected. As a result, `.xls` files now yield empty text when attached to a chat, and reading an `.xls` through the external-file reader fails with an "Unsupported document format" error instead of returning garbled binary content.

## Why this matters to the user

A user who attaches a legacy `.xls` spreadsheet will find that the model receives no content from it, and a user who opens an `.xls` via a flow backed by the external-file reader will see a read error rather than partial text.

## What the user should do

Re-save legacy `.xls` files as `.xlsx` before attaching or opening them.

## Notes for release manager

Only `.xls` is affected — it was the sole legacy binary format still routed through officeparser (`.doc` continues to use word-extractor). The two code paths handle the dropped format differently by design: chat attachment text extraction returns an empty string, while the external-file reader throws.
