---
title: Migration failures can save a diagnostic bundle
category: data-migration
severity: notice
introduced_in_pr: '#17243'
date: 2026-07-21
---

## What changed

Migration failure and blocked-upgrade screens, including native preboot failures, can now save a
diagnostic ZIP and offer shortcuts to open a prefilled support email, reveal the file, or copy the
support address. Successful migration behavior is unchanged.

## Why this matters to the user

The bundle provides basic migration diagnostics and, when available, every application log from the
user's local calendar day at save time. If that day has no application log, an active migration run
falls back to the local day when it failed (or started when no failure time exists); logs from the two
days are never combined. The selected log set is all-or-none: if any matching log cannot be read
consistently, the ZIP keeps the basic diagnostics and records why logs were omitted. Logs are not
redacted and may contain file paths, error stacks, user content, or credentials; the app never
uploads, attaches, or sends the ZIP or email automatically, and every successful save states this
explicitly.

## What the user should do

Inspect the ZIP before sending it, then attach it to the prefilled email manually. If the saved notice
says logs were not included, follow its retry guidance; the basic diagnostics remain usable. If the
final ZIP is larger than 15 MiB, use the email provider's large-attachment feature or a cloud-storage
link.

## Notes for release manager

The support bundle appears only on migration failures and version-upgrade blocks. Logs stream into
the archive instead of being buffered in memory; a collection or stream failure falls back to an
atomically written basic-only bundle. No diagnostic behavior changes the successful migration path.
