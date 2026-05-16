---
title: Knowledge base file imports now use an explicit supported format list
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-05-15
---

## What changed

Knowledge base file import now accepts only a narrow explicit format list: TXT, Markdown, PDF, DOCX, EPUB, CSV, JSON, and Drafts export. Other extensions that v1 may have accepted as generic text, such as code, log, config, SQLite, or unknown binary files, are now rejected instead of being treated as plain text.

## Why this matters to the user

Users may see more files skipped or rejected than in v1 when adding files, saving message attachments to knowledge, expanding directories, or migrating legacy knowledge data.

## What the user should do

Use supported text or document formats for knowledge sources. Convert unsupported binary files to a readable text or document format before importing.

## Notes for release manager

Supported extensions after this change: `.txt`, `.md`, `.markdown`, `.pdf`, `.docx`, `.epub`, `.csv`, `.json`, `.draftsexport`.
