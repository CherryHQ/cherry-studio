---
title: Default assistant name is seeded in English
category: changed
severity: notice
introduced_in_pr: #15943
date: 2026-06-12
---

## What changed

Fresh v2 databases seed the built-in default assistant with the fixed name `Default Assistant`. The persisted assistant name no longer follows the app language the way the old synthetic default assistant label did.

## Why this matters to the user

Users who start Cherry Studio in a non-English language may see the initial default assistant named `Default Assistant` instead of a localized name. The assistant remains ordinary user data and can be renamed or deleted.

## What the user should do

Nothing — automatic. Rename the default assistant manually if a localized or custom name is preferred.
