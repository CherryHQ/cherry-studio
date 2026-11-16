# Agent Note: Pi Durable image deduplication in SQLite

Status: implemented

English | [中文](2026-11-16-pi-durable-image-storage.zh.md)

## Problem

Pi Durable 1.5.2 stores JSON records with inline Base64 images. The same image can recur in entries, task input/state/results, submissions and document revisions. Context compaction preserves retained history; rebuilding the same records does not remove image duplication.

The [runtime contract](../../proposed/architecture/2026-10-17-agent-runtime-contract.md) continues to own runtime boundaries. Product session messages remain projections, not a replacement recovery source. This decision owns only the native SQLite representation and its migration.

## Decision

The existing Pi Durable dependency patch implements image storage inside native SQLite. No upstream release or upstream PR is claimed. The implementation preserves existing dependency patches and uses the portable database interface; Cherry only calls the native migration after backend identity validation.

Schema version 3 adds a SHA-256-keyed BLOB table and a separate image-reference manifest on each record/revision row. This avoids collisions with arbitrary user JSON. Binary bytes are shared within a backend; MIME metadata stays at each reference. Canonical Base64 is restored exactly on public reads. Ordinary strings and noncanonical encodings stay inline. Record values and model input remain unchanged.

SQLite triggers account for references in the same transaction as record writes. Garbage collection runs after accepted writes, retaining resources referenced by historical revisions or ancestor entries. Reads hydrate resources within the same transaction as their owning rows and verify their hashes. Missing or corrupt bytes fail explicitly; tools are never replayed to recreate resources.

Image-bearing document deltas are stored as bases at the original sequence and version. This extracts images even when an operation changes only the image data field. Rewindable bases remain available for historical reads and fork copies. Latest-only bases replace obsolete revisions through native retention rules.

`openExisting()` reads native schema version 2 without writes; commits require migration. Desktop verifies the backend marker first, then calls `migrateImages()`. Schema changes append to the native migration chain. Conversion commits pages of 16 rows and marks converted rows in their manifests, so interruption leaves a readable mixed store and reopening resumes conversion. Record IDs, commit sequences, document versions and native bindings remain intact. Normal native `open()` upgrades and converts automatically. Older schema-2 readers reject version 3; downgrade requires a compatible backup.

Resources remain in the backend SQLite file. Existing quiesced/checkpointed backup boundaries include images without separate manifests or directories. Public storage reads produce self-contained logical records for transfer to other storage. Removing the backend file removes its resources. Migration and resource deletion leave reusable SQLite pages; neither schedules `VACUUM` nor expires history.

## Alternatives considered

- Separate content-addressed files require cross-resource publication, backup and orphan recovery. Same-database BLOBs preserve transaction and backup boundaries; cross-backend sharing remains out of scope.
- Non-deduplicated BLOBs remove Base64 overhead but retain repeated payloads.
- Rebuilding from product messages or retaining only compacted context changes native recovery and historical forks, and reimporting all images retains duplication.
- Compressing whole JSON changes unrelated content encoding without giving images independent deduplication and ownership.

## Consequences

Hashing, reference accounting and hydration add work. Hydration returns decoded objects directly, and encoding copies only changed object paths, avoiding another Base64 JSON serialization round-trip. Reads batch resources per selected page; there is no backend-wide image cache. Unique retained images still grow with history. Product message storage and provider request sizes are unchanged.

One local macOS synthetic benchmark used 64 records and four distinct 256 KiB payloads. The published unpatched 1.5.2 package and patched package ran in separate processes. Closed database bytes were 22,532,096 and 1,478,656 respectively; the patched store held four resources totaling 1,048,576 bytes. Both WAL files were empty after close. Write/read times were 66.1/35.7 ms and 88.5/42.8 ms; peak RSS was 115,680 and 132,256 KiB. This is one diagnostic run, not a user-database measurement or a statistical latency guarantee. The reproducible fixture is `packages/agent-runtime-pi-durable/tests/fixtures/imageStorageBenchmark.mjs`.

## Verification

- AC1 — `pnpm test:agent-runtime-pi-durable packages/agent-runtime-pi-durable/tests/imageStorage.test.ts`: repeated entry, task, submission and document images deduplicate; MIME values and fork history survive reopen.
- AC2 — The same test file checks reference-shaped user JSON, noncanonical Base64, paginated reads, data-only deltas and original model image input after native harness reopen.
- AC3 — The same test file injects SQL failure, kills a child process before/after commit and corrupts/removes resource bytes; rollback/reopen preserve complete transactions and reads fail explicitly on damage.
- AC4 — The same test file interrupts legacy conversion after a committed page, retries it, verifies stable history/commit sequences and checks old-version rejection; `pnpm test:main src/main/ai/agentSession/__tests__/nativeContext.test.ts` checks backend identity before migration and existing native recovery contracts.
- AC5 — The image-storage test copies a closed/checkpointed native database, removes the original, restores root/fork images and transfers hydrated entries to MemoryStorage. Desktop connection/native-context integration tests cover the unchanged storage lifecycle; full application backup UI and live-provider acceptance were not run.
- AC6 — The image-storage test replaces latest document and task/submission payloads, checks final-reference reclamation and retained rewindable/fork images, and exercises prefixed schemas through the Durable Object adapter with a local SQL binding. This is not a live Cloudflare deployment.
- AC7 — `node packages/agent-runtime-pi-durable/tests/fixtures/imageStorageBenchmark.mjs [package-directory]`: identical synthetic input round-trips with the database/WAL, unique-resource, latency and process peak-RSS results above.
