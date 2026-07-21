---
title: Migration failures can save a diagnostic bundle
category: data-migration
severity: notice
introduced_in_pr: '#17208'
date: 2026-07-20
---

## What changed

When the v1-to-v2 migration is blocked, Cherry Studio can now save one diagnostic ZIP from the migration page, the
version-incompatibility page, an early native failure dialog, a renderer crash or persistent hang, or recovery of an
unfinished migration.

## Why this matters to the user

The saved privacy-bounded bundle gives developers the current and immediately previous failure summaries,
failure-only sampled value lengths, and bounded read-only database structure and integrity results. It excludes
application logs, the database and its WAL/SHM files, raw errors, absolute paths, credentials, and user content.
Nothing is uploaded or sent automatically.

## What the user should do

Choose **Save diagnostic bundle**, review the ZIP, and manually attach it when contacting Cherry Studio support. If
the migration window remains available, it also offers external email-client, show-in-folder, and copy-address
actions.

## Notes for release manager

This fragment describes the production strict-bundle privacy policy.
