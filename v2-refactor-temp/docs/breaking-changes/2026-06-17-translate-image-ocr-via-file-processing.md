---
title: Translate image OCR now uses File Processing
category: changed
severity: notice
introduced_in_pr: #16125
date: 2026-06-17
---

## What changed

Translate image OCR now runs through the File Processing default image-to-text processor instead of the legacy OCR provider configuration. The default processor is System OCR on macOS and Windows, and Tesseract on Linux.

## Why this matters to the user

Users who previously configured OCR providers for Translate will no longer see that legacy provider system. Translate follows the File Processing image-to-text default, so OCR behavior and processor selection now match the shared File Processing settings.

## What the user should do

Review the default image-to-text processor in File Processing settings and choose a different processor there if needed.

## Notes for release manager

This entry is specifically about the user-visible Translate OCR configuration change. The internal IPC cleanup is not user-visible.
