---
title: Provider API keys and OAuth tokens are now stored encrypted
category: changed
severity: notice
introduced_in_pr: "#<PR-1 number>"
date: 2026-08-22
---

## What changed

Provider credentials in the local database (API keys, OAuth tokens, AWS/GCP credentials) are now stored as encrypted envelopes instead of plaintext. On first launch after the update, existing plaintext credentials are automatically encrypted in place; nothing needs to be re-entered on the same machine.

## Why this matters to the user

- On macOS, the first credential write may show a Keychain access prompt for "Cherry Studio Safe Storage" — choosing Allow is expected and safe. The prompt can also reappear once after switching between dev and packaged builds.
- Credentials are bound to this machine's OS key store. Copying the database file to another computer (or restoring a backup there) will not carry usable credentials: affected entries show a "needs re-entry" state and the values must be re-entered.
- On Linux without a keyring service, a local key file (`secret.key`, 0600) protects the values instead.

## What the user should do

Nothing — encryption is automatic. For cross-machine migration, wait for the plaintext-export backup option (follow-up PR) or re-enter credentials on the new machine. Before downgrading to an older version, note that older builds cannot read the encrypted values.

## Notes for release manager

Decrypt-failure UX (summary dialog + re-entry markers) lands separately in the renderer follow-up (c4); the data layer already returns `decryptFailed` markers. Plaintext-export backup option is PR-2 of the S7 security work.
