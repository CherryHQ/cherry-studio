---
title: Agent browser control and browser data settings
category: changed
severity: notice
introduced_in_pr: 20166
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

History entries open directly in new browser tabs, without an Agent conversation. These tabs share
website data with ordinary Agent browser panes. Their address bars search browsing history by title
or URL, with mouse and keyboard selection.

Browser control now appears under the Agent’s built-in tools. Browser settings owns tool permissions
(ask, allow or block); the legacy browser entry no longer appears in MCP settings or Agent MCP selection.
An optional setting opens website links in shared browser tabs. Explicit external-browser actions and
authentication flows keep their existing destinations.

## What the user should do

Enable Agent control in Settings → Browser when needed. Import starts with a detected browser;
choose a profile only if several exist. Dia (macOS) and Comet (macOS/Windows) appear as separate
import sources from Google Chrome. Vivaldi, Opera and Chromium standard profiles are supported on
macOS, Windows and Linux; Opera supports both root-level and named profile layouts. Profile choices display their names and available accounts,
falling back to directory names when metadata is unavailable. Website data combines cookies and supported local storage,
with file import available as a secondary path. Chromium cookies can use macOS Keychain, Windows
current-user DPAPI, and Linux Secret Service/KWallet. Allow system key access when prompted.
Linux needs secret-tool (libsecret-tools), or kwallet-query and dbus-send. Windows app-bound encryption,
partitioned cookies and Firefox container cookies remain unsupported; sign in again in the pane when
needed. Results explain unavailable keys, denied access, unsupported formats, expired and failed
items separately. Reload open pages after website data was imported. History import remains available
independently. Password stores, extensions and bookmarks are not imported.

## Notes for release manager

Electron remains at 41.8.0. This is stacked on the browser inspection work. Clearing history does not sign users out; clearing site data applies to all ordinary
Agent pages. History is preserved unless its checkbox is also selected. Only cache is preselected. Source browser databases are never modified.
