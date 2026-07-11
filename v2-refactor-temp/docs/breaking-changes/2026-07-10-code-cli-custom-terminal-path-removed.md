---
title: Custom terminal path setting removed from Code CLI launch
category: removed
severity: notice
introduced_in_pr: #16491
date: 2026-07-10
---

## What changed

The Code CLI launch dialog no longer accepts a custom terminal executable path. The terminal is now picked from the list of terminals detected on the system (`code_cli.get_available_terminals`).

## Why this matters to the user

Users who pointed the launcher at a terminal binary outside the detected list (e.g. a portable install in a non-standard location) can no longer do so; only detected terminals are selectable. A previously saved custom path is ignored.

## What the user should do

Install the preferred terminal in a standard location so detection picks it up, or launch the CLI tool manually from that terminal. If custom paths turn out to be needed, file a feature request.

## Notes for release manager

Same PR as the OpenClaw settings-page merge entry; consider grouping under one "Code CLI page rework" section.
