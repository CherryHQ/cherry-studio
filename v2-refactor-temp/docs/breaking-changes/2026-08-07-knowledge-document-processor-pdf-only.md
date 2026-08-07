---
title: Knowledge document processors now run on PDFs only
category: changed
severity: notice
introduced_in_pr: '#18161'
date: 2026-08-07
---

## What changed

A knowledge base's selected document processor (MinerU, Doc2X, Mistral, PaddleOCR,
self-hosted MinerU) is now applied to `.pdf` files only. Word, PowerPoint and Excel
files (`.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, `.xlsx`) added to a knowledge base
are read straight into the index instead of being sent through the processor first.
They are still fully supported — they are just read locally rather than converted
to Markdown by the processor.

## Why this matters to the user

Adding an Office document to a knowledge base is now faster and no longer consumes
processor API quota, and it no longer produces a sibling `.md` artifact next to the
source file. Extraction quality for these formats changes: it now comes from the
built-in reader rather than the chosen processor, which may format tables and
layout differently from before. Files already indexed keep their existing artifact
and are not reprocessed.

## What the user should do

Nothing — automatic. Users who preferred a processor's rendering of a specific
Office document can convert it to PDF before adding it, which routes it through the
processor as before.

## Notes for release manager

Known regression, Windows on ARM only: the built-in reader ships no ARM64 Windows
binary, so on that platform `.ppt`, `.pptx`, `.xls` and `.xlsx` fall back to a
plain-text reader that produces unusable output. Those users previously had a
working path via a document processor and no longer do. Every other platform
(Windows x64, macOS, Linux) is unaffected. Worth calling out separately if the
release note has a platform-specific section.
