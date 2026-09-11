---
title: Cloud sessions are bound to the current computer
category: changed
severity: breaking
introduced_in_pr: '#20222'
date: 2026-09-08
---

## What changed

Cloud login and signed requests now include an application-specific digest of the operating system's machine ID separately from the signing public key. Copying credentials to another computer requires a new login; resetting application data or generating a new signing key does not change the machine code. Credential storage stays in its original location.

## Why this matters to the user

When the server's same-machine free-entitlement policy is enforced, later accounts on a computer that already received an automatic free grant are not given another one. The server records the computer at grant time: signing in on another computer does not consume that computer's grant eligibility. Changing signing keys does not reset grant history. Registration and login remain allowed, and existing entitlements are retained. A missing or invalid system ID prevents new cloud login instead of creating a random device identity.

## What the user should do

Upgrade to matching client and server versions, then sign in again. Old sessions without a machine binding and signature v1 requests are no longer accepted. Moving the data directory within the same computer preserves the session if its credentials are retained.

## Notes for release manager

Apply the Cloud API schema migrations before the coordinated server and client rollout. Signature v2 covers the current machine code, which must match the session's immutable machine binding; re-login replaces only the same account, machine and client-key session. Existing entitlements without a recorded grant machine are retained; their origin is not inferred from login history. Machine IDs are OS-provided identifiers, not tamper-proof hardware attestation; OS reinstallation or cloning can change or duplicate them. Modified clients can still submit fabricated machine codes. No raw machine ID is transmitted, and it is never used to derive a signing private key.
