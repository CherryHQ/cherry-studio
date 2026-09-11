---
title: Knowledge base "Reindex" now re-reads the original source
category: changed
severity: breaking
introduced_in_pr: 19829
date: 2026-09-01
---

## What changed

Reindexing a knowledge base data source now re-acquires it from its real source before rebuilding the
search index, instead of rebuilding from the copy the knowledge base already holds:

- **File** — the user's original file is copied over the knowledge base's copy again; a file that goes
  through a document processor is processed again.
- **Folder** — rescanned from the original folder (unchanged).
- **URL** — the page is fetched again and the stored snapshot is replaced.
- **Note** — the snapshot is rewritten from the note text stored in the app.

Reindexing a file or folder whose original has been moved or deleted is now rejected with "Cannot
reindex a knowledge item whose source file or folder no longer exists; delete it and add it again to
rebuild". Previously it succeeded by rebuilding from the internal copy.

## Why this matters to the user

Reindex finally means "pick up my edits". Editing a document in your own editor and clicking Reindex
now updates search results — previously it changed nothing, because only the app's private copy was
ever read.

Two visible consequences:

- Reindex fails for an item whose original file or folder is gone. This includes items migrated from
  v1, whose recorded original path points into the v1 data directory — if that directory was cleaned
  up, or the profile was restored across platforms, those items can no longer be reindexed.
- Reindexing a URL whose page is now dead (404, domain gone, login required) fails, and that item
  loses its index until the page is reachable again.

## What the user should do

If reindex reports the source no longer exists, delete the data source and add it again.

To maintain a document outside the app and have reindex pick up the edits, add it as a **file** data
source pointing at your own file. Editing the `raw/*.md` files inside a knowledge base directory is
not a supported workflow — reindex overwrites them.

## Notes for release manager

Pairs with the fix for the note preview / search inconsistency reported in #19492: a note's text in
the app is authoritative, and its snapshot file is now regenerated from it on every reindex, so the
preview panel and search results can no longer disagree.
