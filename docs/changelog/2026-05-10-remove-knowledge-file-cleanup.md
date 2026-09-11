---
title: 'Knowledge base file cleanup setting removed'
category: removed
severity: notice
introduced_in_pr: TBD
date: 2026-05-10
---

## What changed

The Data settings page no longer includes the bulk action for deleting stored knowledge base source files.

Deleting knowledge sources and knowledge bases remains available from the Knowledge page. This change only removes the separate storage cleanup shortcut that deleted source files while leaving vector data in place.

## Why this matters to the user

Users who previously used Settings > Data to reclaim space by deleting knowledge base files will no longer see that button in v2.

## What the user should do

Delete unwanted knowledge sources or knowledge bases from the Knowledge page. Going forward, manage knowledge files through the file system instead of the Data settings page.

## Notes for release manager

This removes the legacy v1 Redux/Dexie-backed cleanup path. The v2 knowledge data model does not carry this settings shortcut forward; knowledge file management should belong to the file system surface.
