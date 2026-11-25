# Agent Note: Durable store directory collision

Status: implemented

English | [中文](2026-11-13-durable-store-directory-collision.zh.md)

## Problem

A directory occupying a creating backend's reserved SQLite filename blocks durable turns. `EEXIST` and `EISDIR` do not identify the occupant type. Storage errors without a dedicated identity can appear as network interruptions.

## Decision

For creating backends only, the publisher uses `lstat` after initial `EEXIST` or `EISDIR` to confirm a real directory, excluding symlinks. It moves the directory into a unique sibling quarantine and retries the same exclusive link once. Quarantine contents are retained, never deleted or automatically restored. Backend ID and locator remain unchanged.

Other errno values never authorize mutation. Observed regular files of any validity, symlinks and referents, non-creating occupants, and retry winners are never deliberately moved, deleted, overwritten, or relabeled. Retry `EEXIST` enters strict marker reconciliation. Quarantine failures, including `EEXIST`, are terminal. Storage errors retain native diagnostics and gain localized guidance; identity and binding errors keep their existing behavior.

## Alternatives considered

Recursive deletion loses unknown contents. Fixed backups collide. Locator changes require metadata coordination. Copy fallback cannot preserve exclusive initialized publication. None is used.

## Consequences

Quarantined entries accumulate for separate inspection and management. Logs identify retained paths and terminal operations. Staging cleanup cannot mask a primary error. Initialization and session close precede publication.

`lstat` plus `rename` is not atomic: an external writer can replace the directory before rename. This does not guarantee that no file can move under such a race.

## Verification

- Regression — `nativeContext.test.ts`: pins a completed real-runtime faux turn, preserved sentinel and locator, strict marker validation, reopened answer history, and a second completed input.
- Regression — `durableNativeContext.fsFailures.test.ts`: pins collision codes, terminal quarantine and retry errors, retry winners, symlink and bound-directory preservation, serialized storage identity, and logging.

The locale key `error.durable_storage_failed` was added to all 15 catalogs.
