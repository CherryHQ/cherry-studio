---
title: Agent Markdown links use workspace-aware file navigation
category: changed
severity: notice
introduced_in_pr: "#17135"
date: 2026-08-24
---

## What changed

In agent session messages and rendered Markdown artifact previews, relative local links resolve from the agent workspace root. Absolute links are used as written, and relative links that escape with `..` can target paths outside the workspace. Files open in the artifact pane, while directories open in the system file manager; other Markdown surfaces keep their existing link behavior.

## Why this matters to the user

On those Agent surfaces, users can follow workspace-relative links without routing them through the external-link flow.

## What the user should do

nothing — automatic.
