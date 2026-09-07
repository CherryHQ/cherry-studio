---
title: GitHub Models provider is no longer available
category: removed
severity: breaking
introduced_in_pr: "#19072"
date: 2026-08-21
---

## What changed

The built-in GitHub Models provider has been removed because GitHub retired its playground, model catalog, inference API, and bring-your-own-key endpoints. Existing GitHub Models provider records remain in local storage but are hidden and cannot be used or modified through the app.

## Why this matters to the user

Assistants, conversations, or agent sessions that still reference a GitHub Models model can no longer send requests. Their saved content remains available, but the retired provider cannot serve new generations.

## What the user should do

Select a model from another available provider. Existing GitHub Models provider data remains in local storage and is not deleted automatically.

## Notes for release manager

GitHub announced the service retirement on July 30, 2026. Preset-derived copies of the GitHub Models provider are retired as well.
