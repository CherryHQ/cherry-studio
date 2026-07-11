---
title: Deleting a chat, topic, or painting now reclaims its files
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-07-04
---

## What changed

Deleting a chat topic, message, or painting now reclaims the files that were exclusively created for it (chat attachments, AI-generated images, painting inputs/outputs) once they have no other references — the file record and its physical blob are deleted, not just the owning business row. The Files page no longer accumulates every historical upload forever: files reclaimed this way disappear from the list along with their owner. This is a **silent, automatic** mechanism — there is no user-facing control (no pin/unpin, no "clean up now"): files created outside chat/painting flows (for example, uploaded directly via the Files page) are kept, while files owned by a chat/painting are reclaimed once that owner is gone. Nothing irreplaceable is lost — chat attachments are Cherry's own copies; the user's original file on disk is never touched. Files migrated from a v1 install keep today's "kept forever" behavior unless they were referenced by a migrated chat message or painting, in which case they follow the same reclaim-on-delete lifecycle as newly created files.

## Why this matters to the user

Users who relied on the Files page as a permanent archive of every file ever uploaded or generated will see some files disappear after deleting the chat, topic, or painting that used them — this is expected space reclamation, not data loss of anything still referenced elsewhere. Reclamation is not instant: it runs on a background pass (on app start, and every 30 minutes when idle) with roughly a one-hour grace window, so a file is not removed the instant its owner is deleted.

## What the user should do

Nothing — this is default, automatic, silent behavior. To keep a file beyond its originating conversation, upload it via the Files page (Files-page uploads are retained), or keep the owning chat/painting. The user's original file on disk is never affected either way. v1 users upgrading: files already referenced by a migrated chat or painting follow the new lifecycle; unreferenced legacy library files are left untouched.

## Notes for release manager

- Cleanup and retention are **deliberately invisible** to users (product decision): no pin/unpin control, no "pending cleanup" indicator, no manual "clean up now" action. There is no in-app way to change a file's retention policy after the fact, by design — the file module keeps the user's originals, so nothing irreplaceable is at stake. Rationale in the spec's Decision note.
- Design/spec: `docs/references/file/file-entry-cleanup.md`.
