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

Anyone following an older saved/shared `/app/library?...` URL — or a v1 in-app
"manage in library" / "edit in library" affordance that still builds these links —
lands on the default resource list instead of the targeted tab or dialog.

## What the user should do

Nothing automatic. Open the resource from the library list directly. The deep-link
contract is intentionally dropped in v2; the in-app entry points that still generate
these URLs are part of the v1 surface and will be removed with it.

## Notes for release manager

`src/renderer/pages/library/routeSearch.ts` is kept for now because its `build*` URL
helpers are still imported by the v1 `components/ResourceSelector` and
`pages/home/Messages/Prompt.tsx`; it will be deleted with those v1 call sites. The
now-unused `parseLibraryRouteSearch` (the parsing half of the old contract) lives
there too.
