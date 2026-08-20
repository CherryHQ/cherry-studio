---
title: PDF translation now preserves document layout
category: changed
severity: notice
introduced_in_pr: "#17007"
date: 2026-07-13
---

## What changed

Uploading a PDF on the Translate page now opens a layout-preserving workflow. When BabelDOC Stream is installed it generates translated-only PDF pages — the source pane header shows the file name and close action, and the right pane is labeled Translated PDF. When BabelDOC Stream is not installed it falls back to the previous plain-text extraction, with the right pane labeled Translation, so uploading a PDF never becomes impossible. BabelDOC Stream appears last in Environment Dependencies and must be installed manually; the first translation may download its layout model assets, and subsequent progress is streamed as it parses, translates, typesets, and renders the document. Scanned PDFs are reported as requiring OCR translation, which will be supported in a future release.

## Why this matters to the user

Translated PDFs retain their original page structure and can be previewed beside the source. Users control when the translation runtime is installed, while the first translation still requires a network connection, additional disk space, and more setup time than later runs.

## What the user should do

Install BabelDOC Stream 0.6.4.post1 from Settings > Environment Dependencies, select a configured model supported by the API gateway, then start the translation and allow any initial model downloads to finish. The independently maintained runtime remains AGPL-3.0 licensed and is installed on demand from https://github.com/eeee0717/BabelDOC. Use a born-digital PDF for now because scanned PDF translation is planned for a future release. Export the generated translated PDF when it is ready.

## Notes for release manager

The runtime is installed on demand and is not bundled with the application.
