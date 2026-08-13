---
title: PaddleOCR document parsing now defaults to VL 1.6
category: changed
severity: notice
introduced_in_pr: '#18364'
date: 2026-08-12
---

## What changed

The hosted PaddleOCR preset now uses `PP-OCRv6` for image OCR and `PaddleOCR-VL-1.6` for document parsing.
The image model is unchanged; the document model previously defaulted to `PaddleOCR-VL-1.5`.

## Why this matters to the user

New PaddleOCR document-processing jobs use the newer VL 1.6 model unless the user has configured a custom
capability model override. Existing provider tasks continue with the model used when they were submitted.

## What the user should do

Nothing is required. Users who need a different PaddleOCR model can keep or set a custom model override.

## Notes for release manager

The installed PaddleOCR API SDK supports both defaults and also uses them when callers omit the model.
