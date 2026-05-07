---
title: 'Mini-app: running mini-apps no longer surface in the sidebar'
category: removed
severity: notice
introduced_in_pr: '#14049'
date: 2026-05-07
---

## What changed

The sidebar no longer renders a list of currently-opened mini-apps under the
mini-app entry. The setting that toggled this behavior
(`feature.mini_app.show_opened_in_sidebar`, formerly `showOpenedMinappsInSidebar`
in v1) is removed and is no longer migrated. Open mini-apps are surfaced
exclusively in the AppShell tab bar at the top of the window.

## Why this matters to the user

Users who relied on the sidebar's mini-tab strip to switch between active
mini-apps will lose that affordance. Switching is still fully supported via
the top tab bar — pinning a mini-app tab keeps its webview alive across
switches the same way the sidebar list used to imply.

## What the user should do

Nothing required. The mini-app launcher still lives at the same sidebar entry
and opens each app in a tab. Users who want a particular mini-app to stay
loaded should pin its tab from the top tab bar.

## Notes for release manager

The legacy v1 preference key `showOpenedMinappsInSidebar` is now classified
as `deleted` in the migration pipeline; v1 user values for it are dropped
during v1→v2 migration with no v2 destination.
