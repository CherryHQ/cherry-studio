---
title: Agent browser control and browser data settings
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-09-07
---

## What changed

Browser settings can enable Agent tools for the same page shown in the Agent right pane.
Ordinary pages support HTTP(S), including local networks, and share a dedicated persistent login
profile. Settings also provides searchable history, browser-data import and separate clearing actions.

## Why this matters to the user

Agent actions are visible in the existing browser pane. Imported login data is shared across ordinary
Agent pages; local previews and HTML artifacts retain their separate profiles. Turning Agent control
off leaves manual browsing and saved login data available.

## What the user should do

Enable Agent control in Settings → Browser when needed. Choose a profile or a JSON storage-state /
Netscape cookies file to import data, then reload open pages. Direct Chromium cookie decryption is
unsupported; encrypted, partitioned and Firefox container cookies are skipped. History import remains
available independently. Password stores, extensions and bookmarks are not imported.

## Notes for release manager

Electron remains at 41.8.0. This is stacked on the browser inspection work; fill the PR number when
published. Clearing history does not sign users out; clearing site data applies to all ordinary
Agent pages and preserves history. Source browser databases are never modified.
