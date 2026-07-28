---
title: Backup and restore rebuilt — a restore now replaces the whole database
category: changed
severity: breaking
introduced_in_pr: #17499
date: 2026-07-28
---

## What changed

An export may now complete with explicit resource exclusions when a managed file or folder changes, disappears, is non-portable, or exceeds a per-unit backup limit after the database snapshot boundary. The database snapshot remains complete, but excluded resource bytes are not transported; export, restore preview, and completed restore reporting name grouped causes and bounded safe relative paths. Follow the listed cause before creating a fresh Full backup: stop active writes for changed resources, restore unavailable files, or correct portability and size-limit problems.

Backup and restore moved to a new section (Settings → Data → Backup & restore) and works differently from v1. There is one export, with nothing to choose: "Backup" writes a `.cherrybackup` file containing the complete database plus the app's portable managed files (knowledge base data, paintings, managed notes, agent identity and memory, system workspaces, local skills, stored files). Restoring it **replaces the entire database** with the one in the file and restarts the app — it never merges the backup into what is already there, and there is no per-section or per-domain choice. Restoring leaves anything the backup does not include untouched, but it replaces each managed folder the backup carries (a knowledge base, the notes folder, an agent workspace, a skill) as a whole — content inside one of those that the backup does not carry is gone once the restore is confirmed. The v1 cloud backup destinations (Local backup, WebDAV, S3, Nutstore) stay disabled for now; v2 backup is manual file export and restore only.

## Why this matters to the user

Anyone who used v1's backup expecting it to add missing data to the current profile will get the opposite: everything created since the backup was made disappears from the app when the restore completes, because the backup's database is now the database. Content that depends on files the backup could not carry (see the exclusions above) may be unavailable on a device that does not already have those files, and routine cleanup can later reclaim files the restored database no longer refers to. After any restore, integrations that run programs or reach the network (MCP servers, agent automation, code CLIs) stay switched off until the user re-confirms them on that device, and API keys and other credentials travel inside the backup file in readable form.

## What the user should do

Export a fresh backup before restoring an old one if anything since then is worth keeping. After a restore completes, the app keeps the previous database and every replaced file on disk until "Keep restored data" is confirmed. Before confirming, "Roll back restore" can restart into that immediately preceding state; changes made after the restore are not merged. The app keeps whichever side is displaced until the final result is confirmed, says so with a notice at startup, and pauses routine file cleanup in the meantime. A restore rebuilds Knowledge search indexes from the transported files; if embedding cannot finish, the user can wait, roll back, or explicitly stop rebuilding and keep the restored data, with unfinished items unavailable in search until they are reindexed later. A long export or a large archive being checked can be stopped with the same button that started it. Re-enable the integrations that were switched off, and store `.cherrybackup` files somewhere private.

## Notes for release manager

A v1 `.zip` backup file cannot be selected by the v2 restore UI. However, an already-confirmed v1 restore journal is completed by a strict compatibility gate during upgrade, so there is no separate pending-restore breaking change to announce. Worth a screenshot of the new section and of the confirmation dialog, since the "replaces everything" wording is the whole point.
