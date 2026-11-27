# Agent Note: Recover managed Agent workspaces after data relocation

Status: implemented

English | [中文](2026-10-31-agent-workspace-relocation.zh.md)

## Problem

Copying the application data directory preserves absolute workspace paths and Claude checkpoint configuration paths in SQLite. The copied native history can remain keyed by the old workspace. Existing or archived Agent conversations then fail managed-root validation or cannot resume. Updating only the workspace row does not repair native history ownership.

## Decision

Startup repairs recognized system workspace layouts after driver registration and before session recovery. External workspaces retain their paths. The existing runtime lifecycle service owns ordering; database services are already ready through phase ordering, and no additional lifecycle service is introduced.

The relocation coordinator owns workspace validation, staging, the version-1 `.relocation/<workspaceId>/journal.json` protocol, file publication, and the database transaction. Runtime adapters own their artifact allowlists, native identities, transcript validation, and checkpoint remapping. The data service writes opaque replacement checkpoints for messages in the affected workspace without changing message content or activity timestamps. `AgentWorkspaceStorageService` owns admission blocks until verified recovery completes.

Claude resolves every required history owner, merges nonconflicting project artifacts, preserves unrelated bytes, and remaps managed configuration references. Pi validates its saved identities and checkpoints through its own persistence rules, including initial manual compactions that never flushed history. Pending retired-runtime histories remain with the existing Pi migration. Active, archived, and supported interrupted workspace storage retain their representation; copied directory identities require original ownership and matching contents before rebinding.

## Alternatives considered

- Update only database paths: leaves native histories and configuration references under their old ownership.
- Replace paths throughout stored content: can modify user messages and external configuration without proving ownership.
- Interpret native checkpoints in the host or SQL service: duplicates adapter-private formats and couples database repair to each runtime.
- Commit files without a recovery journal: cannot recover the gap between filesystem publication and the SQLite transaction.

## Consequences

A committed database path distinguishes finalization from rollback. Source and target digests, path containment, link checks, and backups protect interrupted publication; older journal operations, including retired DSH artifact records, remain recoverable. A missing required history or conflicting target preserves recoverable data and blocks the affected workspace instead of creating an empty native conversation. Verified recovery releases the admission block.

The repair adds no public IPC or database schema. It does not relocate logs, remove the old profile, or migrate user-selected workspaces. Copied interrupted storage requires the retained original directory and journal as ownership evidence. Native formats remain adapter-owned while the filesystem/database commit protocol stays centralized.

## Verification

- Regression — `pnpm test:main src/main/ai/agentSession/__tests__/relocateSystemWorkspaces.test.ts --maxWorkers=1 --no-file-parallelism`: real SQLite and filesystem scenarios cover history ownership, archive/copy recovery, malformed native records, rollback, repeated relocation, opaque adapter checkpoint persistence, rejection of cross-workspace checkpoint writes, and release of admission blocks after recovery.
- Regression — `pnpm test:main src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts src/main/ai/agentSession/persistence/__tests__/AgentSessionMessageBackend.test.ts src/main/ai/agents/__tests__/AgentWorkspaceStorageService.test.ts src/main/ai/agents/__tests__/agentDataDirectory.test.ts src/main/ai/agentSession/__tests__/AgentSessionArchivePersistence.integration.test.ts src/main/ai/runtime/__tests__/registerDrivers.test.ts src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts src/main/ai/runtime/pi/PiRuntimeDriver.test.ts src/main/ai/agentSession/fork/__tests__/publication.test.ts --maxWorkers=1 --no-file-parallelism`: affected startup, persistence, storage, driver, and fork consumers retain their contracts.

These files passed together in the focused local run. Native SDK fixtures do not establish packaged Electron, authenticated post-move continuation, or physical cross-volume acceptance.
