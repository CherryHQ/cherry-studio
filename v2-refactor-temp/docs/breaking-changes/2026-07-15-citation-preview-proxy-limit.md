---
title: Citation previews may be unavailable on proxy-only networks
category: platform
severity: notice
introduced_in_pr: "#16893"
date: 2026-07-15
---

## What changed

Ordinary web citation previews now use a DNS-pinned direct connection and no longer inherit the Chromium session proxy. X/Twitter previews keep their existing oEmbed path.

## Why this matters to the user

Users whose network can reach citation pages only through the configured app or system proxy may see an empty preview. The citation title and link remain available.

## What the user should do

Open the citation link directly when a preview is unavailable. Restoring proxy-compatible previews requires a future transport that preserves the same SSRF connection guard.

## Notes for release manager

This is an intentional security trade-off: falling back to Chromium `net.fetch` would restore proxy behavior but reopen the DNS rebinding time-of-check/time-of-use gap.
