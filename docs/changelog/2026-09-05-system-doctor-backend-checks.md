---
title: System Doctor covers additional local environment checks
category: other
severity: notice
introduced_in_pr: '#19992'
date: 2026-09-05
---

## What changed

System Doctor adds 16 checks and retains the existing boot-config and user-data-location checks. Reports cover installation, permissions, storage, providers, MCP, managed tools, and recent errors alongside upstream network checks.

## Why this matters to the user

Running diagnostics does not install updates or delete diagnostic evidence. Incomplete scans and unavailable services are reported rather than treated as healthy. Repairs are limited to boot-config recovery, permission requests, and restarting a selected MCP server.

## What the user should do

Use the settings links in findings for updates, storage management, and hardware acceleration. For a signed-out Cherry account, use the existing sidebar profile entry. No migration or automatic cleanup is required.

## Notes for release manager

Network checks and the diagnostic entry points come from the stacked base PRs, not this PR. This change does not add a new Doctor UI or expand native-module testing beyond the screenshot backend.
