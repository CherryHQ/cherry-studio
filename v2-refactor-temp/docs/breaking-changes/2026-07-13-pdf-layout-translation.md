---
title: PDF translation now preserves document layout
category: changed
severity: notice
introduced_in_pr: "#TBD"
date: 2026-07-13
---

## What changed

Uploading a PDF on the Translate page now opens a layout-preserving bilingual PDF workflow instead of extracting the document into plain text. BabelDOC must be installed manually from Environment Dependencies; the first translation may then download its layout model assets. Translation progress is streamed to the PDF preview as BabelDOC parses, translates, typesets, and renders the document.

## Why this matters to the user

Translated PDFs retain their original page structure and can be previewed beside the source. Users control when the translation runtime is installed, while the first translation still requires a network connection, additional disk space, and more setup time than later runs.

## What the user should do

Install BabelDOC 0.6.3 from Settings > Environment Dependencies, select a configured model supported by the API gateway, then start the translation and allow any initial model downloads to finish. Export the generated bilingual PDF when it is ready.

## Notes for release manager

The runtime is installed on demand and is not bundled with the application.
