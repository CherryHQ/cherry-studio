---
title: Privacy policy acknowledgement is required after the 2026-05-31 update
category: changed
severity: notice
introduced_in_pr: "#17306"
date: 2026-07-23
---

## What changed

New users review the privacy policy as part of onboarding. Existing users whose
stored acknowledgement is missing or older than `20260531` must acknowledge the
updated policy before continuing to use the app.

Acknowledging the update preserves the user's existing anonymous data collection
choice. New installations still default anonymous data collection to enabled.

## Why this matters to the user

The acknowledgement dialog cannot be skipped. Analytics remains inactive until
the latest policy has been acknowledged, and onboarding completion stores the
policy acknowledgement together with the user's current data collection choice.

## What the user should do

Review and acknowledge the policy when prompted. Existing anonymous data
collection choices require no further action.

## Notes for release manager

Users migrated from v1 with `privacyPolicyVersion` already set to `20260531` are
not prompted again. The legacy `privacy-popup-accepted` localStorage flag is not
treated as acknowledgement of this policy version.
