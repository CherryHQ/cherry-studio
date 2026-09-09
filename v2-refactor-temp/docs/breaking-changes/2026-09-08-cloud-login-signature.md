---
title: Cherry Cloud login requires a configured client build
category: changed
severity: breaking
introduced_in_pr: "#20230"
date: 2026-09-08
---

## What changed

Cherry Cloud login is unavailable in builds without the cloud login signing
secret. Other providers and local features continue to work.

## Why this matters to the user

Self-built clients can no longer initiate cloud login without the matching build
configuration. Older clients will also be unable to log in when the cloud backend
starts requiring the signature.

## What the user should do

Use an official build with cloud login configured. Developers targeting their own
backend must configure a matching development secret.

## Notes for release manager

Configure `MAIN_VITE_CHERRY_CLOUD_CLIENT_SECRET` before distributing builds and
coordinate backend signature enforcement with client availability. Backend
verification is not implemented in this desktop repository. Existing device
signatures and session refresh are unchanged.
