# Full Snapshot Readiness

> Status: blocked pending owner-owned snapshot boundaries. This is an implementation inventory, not a public Full archive contract.

Backup v2 Lite is database-only. A future Full archive may be published only when every managed resource owner can capture a resource view that is consistent with the portable database snapshot. A filesystem scan, hash, or post-snapshot drift check can validate a captured view, but cannot prove that the view and the database existed at the same instant.

## Required snapshot protocol

A Full export must:

1. pause and drain writers that can mutate managed resources outside the owner;
2. stop admission of new owner mutations and wait for admitted mutations to settle completely;
3. while every owner is frozen, create the sealed main database snapshot and capture each owner's immutable snapshot handle;
4. release the short global snapshot boundary;
5. have owners stage and verify their handles outside that boundary; and
6. fail the entire export if any owner cannot supply its complete closure.

The Backup service may orchestrate fixed owner APIs, but it must not query domain schemas or recreate domain deletion, soft-delete, path, activation, or reconciliation policy. An owner API must make both its authoritative database relation and its managed root explicit, exclude external paths itself, and not return until an admitted DB-to-filesystem mutation is fully settled.

## Owner inventory

| Owner | Authoritative database relation | Managed data to transport | Mutation boundary today | Required change before Full |
| --- | --- | --- | --- | --- |
| File | `file_entry` internal rows | `feature.files.data` blobs, including recoverable soft-deleted blobs | `FileManager`; `createWriteStream()` commits the file before an asynchronous size update | Its lease must include stream finalisation and the following metadata update, not merely stream construction. External entries remain excluded. |
| Notes | `note` metadata, with filesystem content as the source of truth | `feature.notes.data` only; `feature.notes.path` is external when configured | Renderer `NotesService` and `NotesPage` compose filesystem IPC with later metadata/tree updates | Move create, write, upload, rename, move, and delete into one main-owned note-resource command and snapshot owner. A renderer multi-IPC workflow cannot join a main snapshot lease. |
| Knowledge | `knowledge_base` and `knowledge_item` | each managed base's `raw/` tree and `.cherry/index.sqlite` | `KnowledgeService`, jobs, and vector-store connections; per-base locks do not freeze all bases | Freeze existing and new-base admission, then obtain a sealed index snapshot through the vector-store owner. Never copy a live SQLite main/WAL pair and never replace the index with restore-time embedding. |
| Agent data | `agent` | `feature.agents.data/<agentId>` data, excluding `.claude` and the system-workspace root | `createAgent()` creates a directory then inserts the row; runtime and tools can write the directory | Define one owner for create, deletion/orphan policy, runtime writes, and snapshot. The database must be able to determine the exact managed closure. |
| System workspaces | `agent_workspace` rows with `type = system`, associated sessions | `feature.agents.system_workspaces` for declared system workspaces only | session/runtime code materializes paths after database writes; database deletion does not define filesystem cleanup | Define materialization, deletion, and orphan rules behind the agent owner. User-selected workspaces are external and must never be transported. |
| Skills | `agent_global_skill` and `agent_skill` | canonical `feature.agents.skills` library; not the derived Claude mirror | `SkillService` serializes its own mutations, but agent tools can write the library directly | Drain AI writers, reconcile under the owner lock, freeze the owner, and define whether catalog or canonical library wins after restore. |

## Evidence and blockers

- `src/main/services/file/internal/content/write.ts` performs the post-commit File metadata update after the stream/file commit, so a method-scoped lock is insufficient.
- `src/renderer/services/NotesService.ts`, `src/renderer/pages/notes/NotesPage.tsx`, and `src/main/services/FileStorage.ts` split Notes rename/move/delete across renderer state, filesystem IPC, and later tree metadata reconciliation.
- `src/main/features/knowledge/KnowledgeService.ts` and `src/main/data/api/handlers/knowledges.ts` expose mutations that do not share one profile-wide freeze; `src/main/features/knowledge/vectorstore/` owns the live index connection.
- `src/main/ai/agents/createAgent.ts` creates Agent filesystem state before its database row, while `src/main/data/services/AgentService.ts` deletion does not define its filesystem result.
- `src/main/ai/skills/SkillService.ts` documents that agent file tools write outside `mutationLock`; `src/main/ai/runtime/claudeCode/settingsBuilder.ts` exports the managed skill root to those tools.

Until every row above is closed, `ProfileMutationBarrier` and the resource adapters from PR #17499 (`88d37255fc`) must not be restored. They could detect some drift but would still permit a database/resource mixed point-in-time archive.

## Completion evidence

Before implementing Full producer or restore code, each owner needs deterministic interleaving tests covering filesystem-first and database-first pauses. The tests must prove that a snapshot either waits for the full mutation or rejects it; it must never publish a mixed view. The Full producer then needs one cross-owner test that proves its portable database snapshot and all staged owner handles came from the same boundary.
