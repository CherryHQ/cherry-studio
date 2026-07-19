---
title: Migration failures or warnings can save a diagnostic bundle
category: data-migration
severity: notice
introduced_in_pr: TBD
date: 2026-07-20
---

## What changed

When the v1-to-v2 migration fails or completes with warnings, Cherry Studio can now save one diagnostic ZIP from the
migration page, an early native failure dialog, a renderer crash or hang, or recovery of an unfinished migration.

## Why this matters to the user

The saved strict bundle gives developers bounded migration events and read-only database structure and integrity
results without including application logs, the database or its WAL/SHM files, raw errors, absolute paths,
credentials, or user content. Nothing is uploaded or sent automatically.

## What the user should do

Choose **Save diagnostic bundle**, then use the offered external email-client, show-in-folder, or copy-address action.
Review and manually attach the ZIP when contacting Cherry Studio support.

## Notes for release manager

This fragment describes the Scheme A privacy baseline. Scheme B comparison and the final single-policy production
decision are still pending; update this wording if Scheme B is selected.
