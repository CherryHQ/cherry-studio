---
title: 'Mini-app: running mini-apps strip removed from the sidebar (entry icon stays)'
category: removed
severity: notice
introduced_in_pr: '#14049'
date: 2026-05-07
---

## What changed

**Removed**: the strip of currently-opened mini-app icons that used to render
**under** the mini-app entry in the sidebar (the `activeMiniAppTabs`
mini-tab list) and the preference that toggled it
(`feature.mini_app.show_opened_in_sidebar`, formerly
`showOpenedMinappsInSidebar` in v1).

**Kept**: the mini-app entry itself (the launchpad-style icon in the sidebar
nav). Routing to `/app/mini-app`, the icon mapping, the default
`ui.sidebar.icons.visible` membership, the SidebarIconsManager toggle, the
i18n label, and the migration that rewrites the v1 sidebar literal
`'minapp'` → `'mini_app'` are all unchanged.

Switching between opened mini-apps now lives exclusively in the AppShell
tab bar at the top of the window.

## Why this matters to the user

Users who relied on the sidebar's mini-tab strip to switch between active
mini-apps will lose that affordance. Switching is still fully supported via
the top tab bar — pinning a mini-app tab keeps its webview alive across
switches the same way the sidebar list used to imply.

## What the user should do

Nothing required. The mini-app launcher entry still lives in the sidebar
and opens each app in a tab. Users who want a particular mini-app to stay
loaded should pin its tab from the top tab bar.

## Notes for release manager

The legacy v1 preference key `showOpenedMinappsInSidebar` is now classified
as `deleted` in the migration pipeline; v1 user values for it are dropped
during v1→v2 migration with no v2 destination.
