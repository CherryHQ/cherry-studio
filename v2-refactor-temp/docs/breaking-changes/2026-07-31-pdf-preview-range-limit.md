---
title: Some PDFs may require the default app
category: changed
severity: notice
introduced_in_pr: "#17153"
date: 2026-07-31
---

## What changed

PDF previews now use bounded range reads instead of copying the entire file into the app. PDFs that require a single
contiguous range larger than 16 MiB show an option to open with the system default app.

## Why this matters to the user

Large PDFs can preview with lower memory pressure when each requested range stays within the safety cap, regardless of
total file size. A PDF containing an unusually large individual data stream may no longer preview inline even when
the file itself is smaller than 50 MiB.

## What the user should do

Use **Open with default app** when Cherry Studio reports that part of the PDF is too large to preview safely.

## Notes for release manager

The 16 MiB boundary applies to one contiguous pdf.js range, not to the total PDF size. Removing it safely requires a
local transport that can stream range bodies without assembling them in the renderer.
