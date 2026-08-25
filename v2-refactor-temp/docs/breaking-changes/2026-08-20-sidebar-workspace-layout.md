---
title: Three navigation layouts are available without changing the default
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-20
---

## What changed

The main window now offers Sidebar-only, Tabs-only, and Sidebar + Tabs layouts in Settings → Laboratory. Sidebar + Tabs remains the default and preserves the navigation behavior from previous releases.

## Why this matters to the user

Existing users see no layout or navigation change after upgrading. Sidebar-only keeps one live workspace per app and preserves page state while removing the top tab bar. Tabs-only hides the Sidebar and keeps the parallel tab workflow. Only Sidebar-only shows the fixed Sidebar Launchpad button; both tab-bearing layouts use the top new-tab button.

## What the user should do

Nothing — automatic. Choose Sidebar or Tabs in Settings → Laboratory to opt into either streamlined layout.

## Notes for release manager

Mention that Sidebar + Tabs remains the default for upgrade compatibility. Running Chat and Agent work continues across app switches and layout changes. Settings, file previews, and release notes use a focused page with a Back action in Sidebar-only and Tabs-only; the combined layout retains the previous ordinary-tab behavior.
