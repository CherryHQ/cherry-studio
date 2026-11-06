# Agent Note: A failed conversation import no longer leaves a ghost assistant

Status: implemented

English | [中文](2026-10-25-import-ghost-assistant-rollback.zh.md)

## Problem

Importing conversations through Settings → Data → 导入外部应用数据 created the target assistant row before parsing the file. Any parse failure (an empty `[]` export passes `ChatgptImporter.validate` vacuously) or mid-persistence failure (unresolvable message parents) returned an error toast but left the assistant — and, for mid-persist failures, partially imported topics and messages — permanently in the database. Retrying the same file stacked one more ghost assistant per attempt.

## Decision

`importConversations` now parses the file before creating anything, so parse-stage failures are side-effect free. When persistence fails after the assistant exists, the rollback removes exactly what this import created, ordered and scoped to survive concurrent user actions in other windows:

- `persistImport` records the topic ids it actually created (`createdTopicIds`); the rollback hard-deletes only those ids, never the assistant's whole topic set — a user can move existing topics under the new assistant while the import is still running, and bulk `deleteTopics: true` would destroy them.
- Each object is cleaned independently (best-effort): the active-state hard-delete (`trash.topic.delete_permanently`, `trash.assistant.delete_permanently`) runs first, and on `TRASH_TARGET_NOT_FOUND` — meaning another window archived the object with a plain delete — the recycle-bin row is purged via the permanent DataApi delete (`/topics/:id`, `/assistants/:id` with `permanent: true`). Both routes are scoped to `targetState: 'active'`, so the fallback is required to reach archived leftovers.
- A skipped object is logged and never masks the original import failure; the caller still sees the persistence error, and an assistant that is truly gone (not found in either state) counts as cleaned.

`ChatgptImporter.validate` now rejects an empty conversation list, aligning it with `AnthropicImporter`, so both entry points fail identically at the validate stage.

## Alternatives considered

- Delete the assistant with `deleteTopics: true` in one call: rejected — the bulk delete is not scoped to this import's topics and hard-deletes topics a user moved under the assistant mid-import (data loss).
- Archive the assistant and rely on the recycle-bin purge job: rejected — archived topics become ownerless rows in the recycle bin, which is the ghost rebased into another surface rather than cleaned up.
- Treat `TRASH_TARGET_NOT_FOUND` as "already gone": rejected for cleanup purposes — plain UI deletes archive rather than hard-delete, so the not-found from these active-scoped routes does not mean the data is gone.

## Consequences

Parse-stage failures write nothing. Persistence-stage failures roll back best-effort: every reachable path attempts full cleanup, including concurrent deletes/archives from other windows, but the rollback itself can fail (a cleanup call erroring for a non-not-found reason leaves that object behind); such leftovers are logged at warn/error and never mask the import's own failure. Repeated imports of the same file still create one assistant per successful import (no dedup) — unchanged behavior, out of scope here.

## Verification

- Regression — `pnpm vitest run --project renderer src/renderer/services/import`: 32 tests cover parse-before-create (empty `[]` for both importers creates nothing), the exact-rollback id list, archived-leftover purge, concurrent topic deletion, a failing cleanup call not masking the original error, and progress monotonicity.
- Regression — real app (dev instance, service level): `importService.importConversations('[]', 'chatgpt')` returns `success: false` with the localized invalid-format message and creates zero assistants.
