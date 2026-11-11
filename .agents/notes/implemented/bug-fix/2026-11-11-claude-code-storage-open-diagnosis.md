# Agent Note: Claude Code storage-open diagnosis

Status: implemented

English | [中文](2026-11-11-claude-code-storage-open-diagnosis.zh.md)

## Problem

A Claude Code session storage-open failure could be presented as an interrupted network response. The runtime rejection discarded its diagnostic before the error reached the stream and renderer.

## Decision

The desktop driver assigns storage-open failures an application translation key and logs the native rejection code and available diagnostic. Connect captures the diagnostic only during its initial open. Rotation does not attach a cause because concurrent runtime operations share the callback. Create failures retain their existing identity.

The renderer uses the application-owned translation for storage failures while retaining classification and provider links for translations requiring a provider component. The turn now ends with a classified storage-open error instead of a network hint. The transport control is unchanged and retains its stream diagnosis.

## Alternatives considered

Reading a shared diagnostic slot during rotation can attribute an unrelated concurrent error to the open. Changing the runtime contract to carry operation-scoped diagnostics would be broader than this repair.

## Consequences

The visible diagnosis identifies the storage-open step without exposing native paths. The native SDK can suppress filesystem details, so the logged diagnostic does not necessarily identify the underlying filesystem condition.

## Verification

- Regression — `desktopRuntime.integration.test.ts`: checks connect attribution, create discrimination, and rotation cause absence.
- Regression — `AiStreamManager.test.ts`: checks partial output and one error event for storage-shaped and transport failures.
- Regression — `serializeError.test.ts`, `ErrorBlock.test.tsx`, `errorClassifier.test.ts`, and `toast.test.ts`: check serialization and presentation of storage and transport errors.
