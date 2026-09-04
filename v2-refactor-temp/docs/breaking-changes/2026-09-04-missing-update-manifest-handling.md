---
title: Update checks explain missing release manifests
category: changed
severity: notice
introduced_in_pr: "#20003"
date: 2026-09-04
---

## What changed

When the managed update feed returns `manifest_missing`, automatic checks use the normal four-hour cadence with existing jitter. Manual checks explain that a published update is unavailable; they do not report the installation as up to date.

## Why this matters to the user

The client makes fewer requests while release metadata is unavailable. Automatic discovery after the feed is repaired can take up to 4.6 hours; other errors retain their existing retry behavior.

## What the user should do

Nothing — automatic. Use Check for Updates to retry immediately. Release-service configuration still needs to be corrected by its operator.
