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
profile. Settings provides compact entries for import, searchable history and clearing, each in its own dialog.

## Why this matters to the user

Agent actions are visible in the existing browser pane. Imported login data is shared across ordinary
Agent pages; local previews and HTML artifacts retain their separate profiles. Turning Agent control
off leaves manual browsing and saved login data available.

## What the user should do

Enable Agent control in Settings → Browser when needed. Import starts with a detected browser;
choose a profile only if several exist. Website data combines cookies and supported local storage,
with file import available as a secondary path. Chromium cookies can use macOS Keychain, Windows
current-user DPAPI, and Linux Secret Service/KWallet. Allow system key access when prompted.
Linux needs secret-tool (libsecret-tools), or kwallet-query and dbus-send. Windows app-bound encryption,
partitioned cookies and Firefox container cookies remain unsupported; sign in again in the pane when
needed. Results explain unavailable keys, denied access, unsupported formats, expired and failed
items separately. Reload open pages after website data was imported. History import remains available
independently. Password stores, extensions and bookmarks are not imported.

## Notes for release manager

Electron remains at 41.8.0. This is stacked on the browser inspection work; fill the PR number when
published. Clearing history does not sign users out; clearing site data applies to all ordinary
Agent pages. History is preserved unless its checkbox is also selected. Only cache is preselected. Source browser databases are never modified.
