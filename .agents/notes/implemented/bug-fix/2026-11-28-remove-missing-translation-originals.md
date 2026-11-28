# Agent Note: Remove missing translation originals from the file library

Status: implemented

English | [中文](2026-11-28-remove-missing-translation-originals.zh.md)

## Problem

Removing a missing PDF original from the file library failed because the translation history still held an optional source reference to it.

## Decision

For an explicit library removal, FileManager checks the original path directly. When the path is missing and every persistent reference is a translation history source, deleting the external entry also clears those optional references through the foreign key cascade. The reference registry declares the exception for optional sources. The filesystem probe runs outside the global path lock, and the deletion transaction rechecks the path and protected references while preserving the history and its required target.

## Alternatives considered

Requiring the user to delete the translation history would discard a valid record and release its translated output for cleanup. Allowing every missing external entry to be removed could break other features that rely on persistent references.

## Consequences

The history retains the original filename and the translated PDF remains available to open or export. The history can no longer open the original or restore the side-by-side view after this removal.

## Verification

- Regression — `src/main/services/file/internal/entry/__tests__/lifecycle.test.ts`: removing a missing original preserves the history and translated file. A present original or a missing original with another persistent reference stays protected. A concurrent path mutation can proceed during the probe, and a reference added during that interval blocks deletion.
