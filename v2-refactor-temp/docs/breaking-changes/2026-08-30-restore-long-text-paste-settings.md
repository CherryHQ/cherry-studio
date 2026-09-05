---
title: Long text pastes inline by default
category: changed
severity: notice
introduced_in_pr: "#18693"
date: 2026-08-30
---

## What changed

Long text pastes directly into the chat input by default on new installations. Existing v2 installations keep the previous file-conversion behavior, while v1 upgrades preserve the user's original setting. The option and its length threshold are available again under Settings → Messages → Input.

## Why this matters to the user

Existing users do not get an unexpected paste behavior change during upgrade. New users can paste long text inline without first changing a setting.

## What the user should do

Nothing — automatic. Existing users can disable the long-text file option in Input settings if inline paste is preferred.
