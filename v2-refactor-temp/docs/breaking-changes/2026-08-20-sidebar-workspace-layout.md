---
title: Sidebar workspaces are the default navigation layout
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-20
---

## What changed

The main window now defaults to Sidebar workspaces instead of showing the Sidebar and top tabs together. Each Sidebar app keeps one live workspace, while users who prefer parallel tabs can switch to the mutually exclusive Tabs layout in Settings → Appearance.

## Why this matters to the user

Switching Sidebar apps preserves page state without duplicating the same navigation controls. When switching to Tabs, only the current workspace appears in the tab bar; other Sidebar workspaces stay available in the background. The Sidebar has a fixed Launchpad button; in Tabs layout the Sidebar is hidden and the top new-tab button remains available.

## What the user should do

Nothing — automatic. Choose Tabs in Settings → Appearance to keep the multi-tab workflow.

## Notes for release manager

Mention that running Chat, Agent, and translation work continues across app switches and layout changes. Settings, file previews, and release notes open as a focused page with a Back action.
