---
title: Cloud login explains when Cherry Studio needs an update
category: changed
severity: notice
introduced_in_pr: "#20229"
date: 2026-09-08
---

## What changed

When Cherry Cloud rejects an unsupported client version, the login prompt now asks the user to update Cherry Studio instead of retrying the same login.

## Why this matters to the user

Retrying cannot resolve a minimum-version requirement. The prompt now distinguishes this condition from a temporary service failure.

## What the user should do

Update Cherry Studio before signing in again.

## Notes for release manager

This change only handles the upgrade-required response. It does not change the server's minimum version or add machine-bound signature v2 support.
