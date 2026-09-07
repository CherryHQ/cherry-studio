---
title: China onboarding returns to CherryIN login
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-09-07
---

## What changed

New users in the China edition sign in to CherryIN during onboarding again. Cherry Account login remains available
behind a fixed onboarding configuration and is disabled by default.

## Why this matters to the user

The primary onboarding action now opens CherryIN authorization instead of Cherry Account authorization in the China
edition. Global-edition onboarding is unchanged.

## What the user should do

Nothing — automatic.

## Notes for release manager

The switch affects onboarding only. Cherry Account sessions, account controls outside onboarding, and the effective
global edition assigned to migrated users are unchanged. CherryIN is available in the China-edition provider registry
again. Verify both switch values for a fresh China-edition profile.
