---
title: Knowledge file handling now uses stricter sources and formats
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-05-15
---

## What changed

The chat attachment menu no longer lists knowledge bases as a source for attaching indexed files. Knowledge base file import now accepts only a narrow explicit format list: TXT, Markdown, PDF, DOCX, EPUB, CSV, JSON, and Drafts export.

## Why this matters to the user

Users who previously selected files from an existing knowledge base inside the chat attachment picker will no longer see that source. Users may also see more files skipped or rejected than in v1 when adding files, saving message attachments to knowledge, expanding directories, or migrating legacy knowledge data.

## What the user should do

Attach the original local file directly from the file picker. Use supported text or document formats for knowledge sources, and convert unsupported binary files to a readable text or document format before importing.

## Notes for release manager

This combines the previous knowledge attachment source removal and knowledge file format whitelist entries. Supported extensions after this change: `.txt`, `.md`, `.markdown`, `.pdf`, `.docx`, `.epub`, `.csv`, `.json`, `.draftsexport`.
