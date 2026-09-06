---
title: Browser MCP snapshots now provide actionable element references
category: changed
severity: breaking
introduced_in_pr: TBD
date: 2026-09-07
---

## What changed

The built-in browser server now exposes click, type, hover, scroll, keyboard,
selection, history, wait and dialog tools. Snapshots return a JSON result containing
an accessibility snapshot with `eN` references and show changes by default.

## Why this matters to the user

Old snapshot numbers were decorative; new references can target interaction tools.
The snapshot `selector` argument is replaced by `scope`, which accepts a ref.
Invalid tab IDs fail instead of silently falling back to the active tab.

## What the user should do

Update custom browser prompts/scripts to read the snapshot result envelope, use
`full: true` for complete snapshots, and pass `scope` refs instead of CSS selectors.
Take a fresh snapshot after navigation. Existing open, execute and screenshot
inputs remain compatible.

## Notes for release manager

PR2 builds on browser session engine PR #20128. Uploads and visible-pane control
are not included. Managed idle tabs are reclaimed using shared resource budgets.
