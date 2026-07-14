---
title: PDF translation now preserves document layout
category: changed
severity: notice
introduced_in_pr: "#TBD"
date: 2026-07-13
---

## What changed

Uploading a PDF on the Translate page now opens a layout-preserving workflow that generates translated-only PDF pages instead of extracting the document into plain text. BabelDOC must be installed manually from Environment Dependencies; the first translation may download its layout model assets, and subsequent progress is streamed as BabelDOC parses, translates, typesets, and renders the document. Scanned PDFs with an existing OCR text layer use BabelDOC's OCR workaround automatically; image-only PDFs must be processed with OCR first.

## Why this matters to the user

Translated PDFs retain their original page structure and can be previewed beside the source. Users control when the translation runtime is installed, while the first translation still requires a network connection, additional disk space, and more setup time than later runs.

## What the user should do

Install BabelDOC 0.6.3 from Settings > Environment Dependencies, select a configured model supported by the API gateway, then start the translation and allow any initial model downloads to finish. Add an OCR text layer before translating an image-only scanned PDF. Export the generated translated PDF when it is ready.

## Notes for release manager

The runtime is installed on demand and is not bundled with the application.
