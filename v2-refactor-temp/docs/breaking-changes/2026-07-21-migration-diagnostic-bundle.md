---
title: Migration failures can save a diagnostic bundle
category: data-migration
severity: notice
introduced_in_pr: TBD
date: 2026-07-21
---

## What changed

Migration failure and blocked-upgrade screens, including native preboot failures, can now save a
diagnostic ZIP and offer shortcuts to open a prefilled support email, reveal the file, or copy the
support address. Successful migration behavior is unchanged.

## Why this matters to the user

The bundle provides basic migration diagnostics and, when available, the original application logs
from the user's local calendar day at save time. Those logs are not redacted and may contain file
paths, error stacks, user content, or credentials; the app never uploads, attaches, or sends the ZIP
or email automatically.

## What the user should do

Inspect the ZIP before sending it, then attach it to the prefilled email manually. If the saved notice
says logs were not included, try saving again; if the final ZIP is larger than 15 MiB, use the email
provider's large-attachment feature or a cloud-storage link.

## Notes for release manager

The support bundle appears only on migration failures and version-upgrade blocks. A log collection
failure does not prevent the basic diagnostic bundle from being saved, and no diagnostic behavior
changes the successful migration path.
