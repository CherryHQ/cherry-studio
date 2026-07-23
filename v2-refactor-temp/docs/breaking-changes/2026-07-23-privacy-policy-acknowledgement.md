---
title: Privacy policy acknowledgement is required after the 2026-05-31 update
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-07-23
---

## What changed

New users review the privacy policy as part of onboarding. Existing users whose
stored acknowledgement is missing or older than `20260531` must acknowledge the
updated policy before continuing to use the app.

Acknowledging the update resets anonymous data collection to enabled. Users who
previously disabled it can turn it off again under **Settings > Data Settings >
Privacy Settings**.

## Why this matters to the user

The acknowledgement dialog cannot be skipped. Analytics remains inactive until
the latest policy has been acknowledged, and onboarding completion stores the
policy acknowledgement together with the user's current data collection choice.

## What the user should do

Review and acknowledge the policy when prompted. After acknowledgement, revisit
Privacy Settings if anonymous data collection should remain disabled.

## Notes for release manager

Users migrated from v1 with `privacyPolicyVersion` already set to `20260531` are
not prompted again. The legacy `privacy-popup-accepted` localStorage flag is not
treated as acknowledgement of this policy version.
