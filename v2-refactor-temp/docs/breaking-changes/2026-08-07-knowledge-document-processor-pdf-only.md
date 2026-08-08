---
title: Knowledge document processors now run on PDFs only
category: changed
severity: breaking
introduced_in_pr: '#18161'
date: 2026-08-07
---

## What changed

A knowledge base's selected document processor (MinerU, Doc2X, Mistral, PaddleOCR,
self-hosted MinerU) is now applied to `.pdf` files only. Word, PowerPoint and Excel
files (`.doc`, `.docx`, `.pptx`, `.xls`, `.xlsx`) added to a knowledge base are read
straight into the index by the built-in reader instead of being sent through the
processor first. They are still accepted — what changes is which component extracts
their text.

## Why this matters to the user

The processor and the built-in reader were always alternatives, never both: once a
processor produced its Markdown, indexing read that file instead of the original. So
this is a change of extraction engine, not the removal of a redundant pass. Tables
and layout may be formatted differently from before for these formats. In exchange,
adding an Office document is faster and leaves no sibling `.md` artifact next to the
source; for the hosted processors (MinerU, Doc2X, Mistral, PaddleOCR) it also spends
no API quota and no longer uploads the document to a third-party service. Files
already indexed keep their existing artifact and are not reprocessed.

## What the user should do

**Windows on ARM64 users: check any `.pptx`, `.xls` or `.xlsx` you keep in a
knowledge base.** The built-in reader ships no ARM64 Windows binary, so on that
platform those three formats fall back to a plain-text reader that produces unusable
output — and unlike before, selecting a document processor no longer routes around
it. Convert those files to PDF and re-add them; PDFs still go through the chosen
processor. `.doc` and `.docx` are unaffected (they have working fallback readers).

On every other platform (Windows x64, macOS, Linux) nothing is required. Users who
preferred a specific processor's rendering of an Office document can convert it to
PDF before adding it, which routes it through the processor as before.

## Notes for release manager

Known regression, Windows on ARM64 only, affecting `.pptx` / `.xls` / `.xlsx`: those
users previously had a working path via a document processor and no longer do. Worth
calling out separately if the release note has a platform-specific section.

Two scoping notes so this is not over-reported:

- `.doc` / `.docx` are **not** affected on any platform — they fall back to dedicated
  readers, not the plain-text one.
- `.ppt` is **not** part of this change. It was never routed through a document
  processor (it is absent from the pre-change extension list), so it neither gained
  nor lost a processor route here. Its Windows-ARM64 behaviour is pre-existing.
