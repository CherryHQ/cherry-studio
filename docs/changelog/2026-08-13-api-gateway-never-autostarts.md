---
title: The API Gateway no longer starts on its own
category: changed
severity: notice
introduced_in_pr: "#18523"
date: 2026-08-13
---

## What changed

The API Gateway now starts only when it is switched on in Settings → API Gateway. It used to start
itself on every launch as soon as any agent existed, and the switch was flipped back on behind the
user's back — so turning it off never stuck.

Agents whose model has to be bridged through the gateway no longer start it silently either. They
ask first: a dialog offers to enable the gateway. Enabling does not resend anything — send the
message again once the gateway is up.

## Why this matters to the user

Turning the gateway off now keeps it off across restarts, and the local port stays closed. Anyone
who runs an agent on a model that is not served natively by an Anthropic-compatible endpoint will
see the enable prompt once; accepting it restores the previous behavior for good.

## What the user should do

Nothing — automatic. Users who want the gateway off should turn it off once in
Settings → API Gateway; unlike before, it will stay off.

## Notes for release manager

Fixes issue #18521. External CLI tools configured against Cherry Gateway on the Code page are
unaffected: choosing that provider still enables the gateway, so it keeps coming up on launch.
