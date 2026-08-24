---
title: Local Markdown links open in the artifact pane
category: changed
severity: notice
introduced_in_pr: "#17135"
date: 2026-08-24
---

## What changed

Links to workspace files in an agent artifact's rendered Markdown preview now open the target file in the artifact pane. Relative links resolve from the agent workspace root.

## Why this matters to the user

Following a local link no longer sends it through the external-link flow, and links are interpreted consistently with paths in agent messages.

## What the user should do

nothing — automatic.
