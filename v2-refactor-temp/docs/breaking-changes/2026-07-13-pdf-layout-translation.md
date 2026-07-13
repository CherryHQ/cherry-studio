---
title: PDF translation now preserves document layout
category: changed
severity: notice
introduced_in_pr: "#TBD"
date: 2026-07-13
---

## What changed

Uploading a PDF on the Translate page now opens a layout-preserving bilingual PDF workflow instead of extracting the document into plain text. The first translation installs the required runtime tool and downloads its layout and translation model assets.

## Why this matters to the user

Translated PDFs retain their original page structure and can be previewed beside the source, but the first run requires a network connection, additional disk space, and more setup time than later runs.

## What the user should do

Select a configured model supported by the API gateway, start the translation, and allow the initial downloads to finish. Export the generated bilingual PDF when it is ready.

## Notes for release manager

The runtime is installed on demand and is not bundled with the application.
