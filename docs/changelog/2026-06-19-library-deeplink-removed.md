---
title: Library deep links no longer open a specific resource or dialog
category: removed
severity: notice
introduced_in_pr: #16187
date: 2026-06-19
---

## What changed

The rewritten library page no longer reads the `resourceType`, `action`, and `id`
query parameters. URLs such as `/app/library?resourceType=assistant&action=edit&id=...`
(open the assistant tab and the edit dialog), `?action=create`, or
`?resourceType=...` (open a specific resource list) now just open the library on its
default list — the requested tab, create dialog, or edit dialog is no longer opened
automatically.

## Why this matters to the user

Only an older saved/shared `/app/library?...` URL (e.g. a bookmark) is affected — it
now lands on the default resource list instead of the targeted tab or dialog. The
in-app entry points that used to build these URLs (the v1 ResourceSelector row
"edit" / footer "create" actions and the home system-prompt box) have been updated in
this PR to stop generating them, so there is no live regression inside the app.

## What the user should do

Nothing automatic. Open the resource from the library list directly. The deep-link
contract is intentionally dropped in v2.

## Notes for release manager

`src/renderer/pages/library/routeSearch.ts` has been deleted along with its only
callers (the v1 `components/ResourceSelector` edit/create actions and the
click-to-edit on `pages/home/Messages/Prompt.tsx`). No remaining code builds or parses
the old query contract.
