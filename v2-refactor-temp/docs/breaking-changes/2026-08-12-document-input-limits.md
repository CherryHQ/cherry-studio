---
title: Document processors now enforce input limits before upload
category: changed
severity: breaking
introduced_in_pr: '#18364'
date: 2026-08-12
---

## What changed

Documents now fail before provider preparation when they reach a configured file-size limit: PaddleOCR 50 MB,
MinerU and Open MinerU 200 MB, and Doc2X 1 GB. These are the providers' existing exclusive upload limits, now
enforced by the common file-processing path. PDFs sent to hosted processors also fail when they exceed the
configured page limit: PaddleOCR 100 pages, MinerU 600 pages, and Doc2X or Mistral 1000 pages. Cherry Studio does
not automatically split an over-limit document. Local document processing keeps its existing behavior.

## Why this matters to the user

Adding the document to a knowledge base still starts asynchronously, but the knowledge item later becomes
`failed` instead of sending an input the selected service cannot accept or fully process. Its error tooltip states
the applicable limit and asks the user to compress or split the document; no partial document is indexed.

## What the user should do

Compress or split the document into files that each fit the selected processor's size and page limits, then add
those files to the knowledge base again. Reindexing checks the currently selected processor and its current limits.

## Notes for release manager

Remote tasks submitted before an upgrade continue polling without the new preflight. The local document handler's
300-page runtime protection remains unchanged. Mistral and local document processing do not declare a common
file-size limit.
