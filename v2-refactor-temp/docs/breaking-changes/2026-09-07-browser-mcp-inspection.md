---
title: Browser agents can find elements and inspect page diagnostics
category: changed
severity: notice
introduced_in_pr: "TBD (browser-use-inspection)"
date: 2026-09-07
---

## What changed

The built-in browser server adds `find`, `console_messages` and `network_requests`.
Element actions can recover a uniquely named replacement after a page rebuilds it,
provided the document has not changed.

## Why this matters to the user

Agents can find offscreen elements and diagnose page errors and failed requests
without executing custom JavaScript. Ambiguous replacements still require a new
snapshot; failed actions are not automatically repeated.

## What the user should do

Nothing — automatic. Custom prompts can use the new inspection tools and their
bounded result arrays; take a fresh snapshot when a reference is stale.

## Notes for release manager

PR3 builds on browser MCP PR #20134. Fill the PR number when published. WebMCP,
Electron upgrades and visible-pane control are separate follow-ups.
