# DB Restore Promotion

Offline-merge + preboot-promotion primitives for the backup restore flow.
The backup pipeline imports backup rows into a detached `work.sqlite` (a `VACUUM INTO` copy of live), stages file resources, writes a `staged` journal, and relaunches; the preboot promotion gate then swaps `work.sqlite` in by atomic rename during the zero-connection window. The live DB is never written during a restore.

**No barrel** — consumers deep-import specific files (same convention as `src/main/core/preboot/`).

## Modules

| File | Exports | Role |
|---|---|---|
| `restoreJournal.ts` | `RestoreJournal(Schema)`, `PROMOTION_STEP_ORDER`, `readRestoreJournal` / `writeRestoreJournal`, `hasPendingRestore` | Crash-safe journal contract (sidecar `restore-journal.json`, `feature.backup.restore.file`; MUST stay in the DB's directory — journal dir-fsyncs are what make a commit-step marker imply the DB rename is durable) |
| `checkpoint.ts` | `checkpointTruncateAssert` | Asserted `wal_checkpoint(TRUNCATE)` — shared by both fingerprint sides |
| `hashDbFile.ts` | `hashDbFile` | Streaming sha256 of the DB main file — shared by both fingerprint sides |
| `snapshot.ts` | `snapshotTo` | `VACUUM INTO` snapshot (produces the merge base `work.sqlite`) |
| `appliedChain.ts` | `readAppliedChain` | The only legitimate source of a journal's `chain` |

`DbService.createSnapshot` / `DbService.checkpointTruncate` are readiness guards delegating to `snapshotTo` / `checkpointTruncateAssert` on the live connection.

## Journal state machine

```
staged ──gate passed──▶ promoting ──▶ completed (work promoted, integrity ok)
   │                        └───────▶ failed    (crash rollback / integrity failure)
   └──gate refused─▶ expired  (fingerprint/chain mismatch, work sidecar unsealable,
                               add-target conflict)
```

- `staged` — written by the backup staging pipeline after offline merge + verification.
- `promoting` — set by the preboot gate; `step` is the write-ahead marker (see `PROMOTION_STEP_ORDER`; ordering comparisons MUST use `indexOf` on that table, never string comparison).
- Markers are recovery hints, not ground truth: around the commit boundary the gate decides from filesystem reality (`work` / `live` / `aside` existence) — a landed commit rename with a lagging or unwritable marker resumes forward, an interrupted revert (cleared aside) finishes the revert.
- Terminal states (`completed` / `failed` / `expired`) are kept for post-boot reporting.

## Ownership

| Artifact | Owner |
|---|---|
| `restore-journal.json` read/write primitives | this module |
| Journal state transitions during promotion | promotion gate (`src/main/core/preboot/backupRestoreGate.ts`) |
| `restore-staging/` tree content (`feature.backup.restore.staging`) | BackupService |
| Terminal-journal deletion (after reporting) | BackupService |
| Quarantined corrupt journals (`restore-journal.json.corrupt-<epoch>`) GC | BackupService (kept for forensics, alongside terminal journals) |
| Undo-aside retention/GC | BackupService |

## Writer requirements (staging side)

Before writing a `staged` journal:

1. **Capture `db.fingerprint` on the live connection, before snapshotting**: with every main-side writer quiesced (drain verdict in hand), run `DbService.checkpointTruncate()` then `hashDbFile(livePath)`, and carry the captured value into the `staged` journal when it is eventually written. Sequence: drain verdict → `checkpointTruncate()` → `hashDbFile(livePath)` → `DbService.createSnapshot` (`VACUUM INTO` is a read transaction — it leaves the live main file untouched, so the hash stays valid and `work.sqlite` is built from exactly the fingerprinted state). Do NOT open a second runtime connection for the checkpoint: the app's single better-sqlite3 connection is what makes `busy==0 && log==checkpointed` trivially hold, and a parallel connection is the one thing that could make the checkpoint see a reader (the gate's fresh `new Database(livePath)` exists only because no DbService is alive at preboot). If the assert throws during staging, treat it as a quiesce leak / foreign connection and abort the restore attempt (fail-closed). The write gate must hold from capture until relaunch — any live write after capture flips the hash and the gate expires the restore.
2. **Seal `work.sqlite`**: `checkpointTruncateAssert` + close ALL connections + assert no `-wal`/`-shm` remains. A dirty exit leaves committed restore data in the WAL; the gate renames only the main file, so unsealed WAL content would be silently lost (the gate re-seals defensively, but sealing is the writer's contract).
3. **`chain` MUST come from `readAppliedChain(work)`** — never from the app's bundled migration list: drizzle's `migrate()` silently no-ops on an ahead-of-code DB, so the bundled list can be a strict subset of what the DB actually applied.
4. **Add targets (`blob-add` / `dir-add` / `note-add` livePath) must not pre-exist**: the gate preflights this at admission and expires the restore on any conflict; a conflicted target is never clobbered by apply nor deleted by rollback.
