# Agent Note: Reject invalid knowledge URLs before adding sources

Status: implemented

English | [中文](2026-11-07-knowledge-url-validation.zh.md)

## Problem

The knowledge URL dialog accepted any nonempty string. `knowledge.add_items` also accepted it, so submitting `not a valid URL` closed the dialog and persisted a source that could only fail during indexing. Desktop regression MP-62 reproduced the lost opportunity to correct the input.

## Decision

Validate URL items at the `knowledge.add_items` IPC boundary with the existing `isHttpUrl` predicate. A malformed or non-HTTP URL rejects the entire request before ingestion. The existing dialog error handling keeps the input open and displays the validation error. Valid HTTP and HTTPS URLs still reach the normal asynchronous fetch/index pipeline; network failures remain item errors.

Keep the persisted URL schema and the internal restore input schema unchanged. Previously saved invalid sources must remain readable, deletable, and restorable rather than becoming inaccessible after this fix.

## Alternatives considered

- Dialog-only validation would leave other IPC callers able to persist invalid inputs.
- Tightening the shared entity/restore schema would reject existing records during reads or restoration.
- Checking network reachability during validation would turn temporary network failures into input errors.

## Consequences

New URL sources require an absolute HTTP or HTTPS URL. A mixed selection containing an invalid URL is rejected as a whole, so a correction cannot accidentally duplicate a partially imported batch. This is syntax validation, not a network access policy.

## Verification

- Regression — `src/main/ipc/handlers/__tests__/knowledge.test.ts`: malformed and non-HTTP URLs reject the batch before ingestion; valid URLs are accepted; existing invalid entity and internal restore inputs remain readable.
- Regression — `src/shared/utils/__tests__/url.test.ts`: the shared predicate accepts HTTP(S) and rejects unsupported or missing schemes.
