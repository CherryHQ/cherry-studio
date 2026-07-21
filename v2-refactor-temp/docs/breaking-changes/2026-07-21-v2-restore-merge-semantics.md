---
title: v2 restore merges backups with FIELD_MERGE for natural-key conflicts
category: changed
severity: notice
introduced_in_pr: #17206
date: 2026-07-21
---

## What changed

Restoring a v2 `.cbu` backup now merges into the existing data instead of failing or
replacing it. Items missing locally (settings, providers and their API keys, model lists,
agent workspaces, tags, chat topics) are restored from the backup.

When the same natural-key identity already exists locally (e.g. the same provider id /
workspace path / tag name):

- **Local non-empty values are kept** (including API keys that are already present).
- **Empty local fields are filled from the backup** (SQL NULL by default; provider
  `apiKeys=[]` / empty `authConfig` skeletons also count as empty via field-merge policy).
- **Models and other absent members under a conflicted provider are imported** — a
  fresh-install seeder placeholder no longer swallows custom models from the backup.
- uuid-entity rows (chats, agents, …) still SKIP on id collision; settings-class
  preference/note keep local-first SKIP.

Links from restored items to something that exists in neither the backup nor the local
data are cleared (optional links) or the affected item is left out (required links) rather
than aborting the whole restore. Attachment soft-refs whose blobs were not staged
(DB-only restore) are disclosed in merge diagnostics.

## Why this matters to the user

- On a fresh install, restoring a backup brings back settings, providers, API keys,
  custom models, workspaces, tags, and chats.
- On a machine that already has data, restore is additive for non-empty local fields:
  your local API keys stay; backup fills only empty credential slots and adds missing
  models.
- **Deleted-vs-empty resurrection**: if you deliberately cleared a field to SQL NULL
  (or emptied a seeded `apiKeys=[]` slot) on the new machine, restoring an older backup
  will fill that field from the backup. Treat restore as "fill empties from backup", not
  "preserve my intentional deletes of nullable fields".

## What the user should do

Nothing for the common case — automatic. To keep a local intentional empty after restore,
re-clear the field after restoring, or remove the backup's version of that item before
restore. Overwrite/rename restore strategies remain unavailable.

## Notes for release manager

Skipped conflicts, cleared/pruned links, and unstaged attachment soft-refs are currently
only logged (main process log, `merge completed with disclosed degradations`); an in-app
disclosure after restart is a planned follow-up. Overwrite/rename restore strategies
remain unavailable. Non-deterministic natural-key identity propagation (rewrite orphan
FKs to the local canonical PK instead of prune) remains a follow-up.
