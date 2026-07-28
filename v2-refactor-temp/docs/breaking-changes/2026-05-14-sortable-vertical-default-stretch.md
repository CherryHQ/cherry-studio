---
title: Vertical Sortable lists now stretch children to full width by default
category: changed
severity: notice
introduced_in_pr: '#14631'
date: 2026-05-14
---

## What changed

The default vertical layout of `Sortable` (from `@cherrystudio/ui`) switched
its cross-axis alignment from `items-center` to `items-stretch`. Vertical
sortable lists — used in Provider Settings v2 (provider list, model list,
api-key list) and elsewhere — now render each item full-width along the
container's main axis instead of hugging its intrinsic content width.

## Why this matters to the user

Affected lists look slightly different in v2:

- Items that used to sit centered with whitespace on both sides now span
  the full row, so drag handles, kebab menus, and right-side action clusters
  land flush against the row edges.
- Selected / hover states cover the full row width, matching the rest of the
  v2 settings UI.
- Horizontal sortable lists are unchanged (still `items-center`).

## What the user should do

Nothing — automatic. Drag-and-drop behavior is identical; only the visual
width of each row changes.

## Notes for release manager

Component-level change in `@cherrystudio/ui` (`packages/ui/src/components/composites/Sortable/Sortable.tsx`).
External consumers that depended on the previous `items-center` default and
want the v1 look back can wrap items in a fixed-width container or pass an
explicit `className` override on the `Sortable` row. No code change is
required inside the Cherry Studio app itself.
