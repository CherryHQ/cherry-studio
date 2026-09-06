---
title: Model-native web tools are used by default
category: changed
severity: notice
introduced_in_pr: "#19784"
date: 2026-08-31
---

## What changed

Web search and URL fetching now use model-native capabilities by default, with an automatic fallback to configured services when the model does not support them or they are unavailable. During upgrade, the existing source preference is preserved under the new positive setting.

## Why this matters to the user

New installations prefer model-native web tools. Existing users keep their effective source priority after upgrading, and both choices continue to fall back automatically when the preferred side is unavailable.

## What the user should do

Nothing — automatic. To prefer configured services, turn off **Prefer model-native web tools** under Settings → Web Search.

## Notes for release manager

The preference is migrated once by inverting the legacy value, so its effective routing choice remains unchanged.
