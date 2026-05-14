---
title: Knowledge files can no longer be attached directly from the chat attachment menu
category: removed
severity: notice
introduced_in_pr: TBD
date: 2026-05-14
---

## What changed

The chat attachment menu no longer lists knowledge bases as a source for attaching indexed files. Local file upload remains available from the same menu.

## Why this matters to the user

Users who previously selected files from an existing knowledge base inside the chat attachment picker will no longer see that source.

## What the user should do

Attach the original local file directly from the file picker.

## Notes for release manager

This follows the v2 FileManager migration: knowledge file items now store a FileManager entry reference instead of an inline file path.
