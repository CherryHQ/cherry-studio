---
title: Knowledge folders keep their search index through the v1 → v2 migration
category: data-migration
severity: notice
introduced_in_pr: '#16093'
date: 2026-06-11
---

## What changed

Folders added to a v1 knowledge base now carry their search index through the v1 → v2 migration: the folder and its files stay searchable immediately, with no re-embedding. (Revised 2026-06-13 — this reverses the earlier behavior where every migrated folder showed a "Re-embed needed" badge. Revised 2026-06-17 — the unreadable-vectors fallback is now a red "migration failed" status that asks the user to delete and re-upload the folder, replacing the amber "Re-embed needed" badge.) A folder only falls back to a red "migration failed" status when its v1 vectors cannot be read.

## Why this matters to the user

In v1, a folder's files were embedded under the folder entry itself with no per-file records. The migration now reconstructs that structure: the folder becomes a container with one entry per embedded file, and each file's v1 vectors are reused as-is (no embedding API calls re-spent). The migrated file entries are searchable but keep no copy of the original file inside the knowledge base — v1 never stored the folder inside the app, so there is nothing to copy; search uses the migrated vectors directly. Re-indexing a single such migrated file is not supported: it has no file under the base's `raw/` folder, so reindex is rejected up front and its existing vectors are never deleted. Re-adding the whole folder always works, and if the folder's original directory is still on disk, reindexing the container rebuilds it for real.

## What the user should do

Nothing in the normal case — folders are searchable right after migration. Only folders that show the red "migration failed" status (their v1 vectors could not be read) need action: delete the folder and re-upload it.

## Notes for release manager

- The legacy v1 vector database is intentionally left on disk per base (rollback safety), so every migrated base's vectors exist twice on disk until a future v1-leftover cleanup ships. That cleanup is a separate, undecided work item — see "v1 leftover cleanup (gap)" in `docs/references/knowledge/experiment/knowledge-technical-design.md` §7. Consider mentioning the disk overhead in the release note if the cleanup has not shipped.
- The migrated per-file entries are `completed` but have no file under the base's `raw/` folder and point at the original external path; the future file-watcher PR must not treat their absence as a delete (see §7 watcher preconditions).
