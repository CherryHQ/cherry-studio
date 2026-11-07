# Agent Note: Read existing plaintext device identity before probing the key store

Status: implemented

English | [中文](2026-11-07-remote-identity-keystore.zh.md)

## Problem

MP-141 supplied a valid profile-owned plaintext identity, but enabling network access blocked Electron’s main thread in SecItemAdd. loadDesktopIdentity checked safeStorage availability before discovering that the existing identity required no key-store operation.

## Decision

Read the existing identity files first. Probe the key store only when decrypting an encrypted identity or choosing storage for a newly created identity.

## Alternatives considered

Changing the user’s keychain or disabling encryption globally would exceed the repair. Generating a replacement identity would invalidate paired devices.

## Consequences

Existing plaintext identities retain their identity and avoid unnecessary interactive key-store access. Encrypted identities still fail closed when secure storage is unavailable; new identities retain the existing encryption policy.

## Verification

- Regression — `deviceIdentity.test.ts` makes key-store discovery fail interactively while reloading an existing plaintext identity. The identity is preserved after the fix; the case failed before it. Encrypted creation and unavailable-key-store cases remain covered.
