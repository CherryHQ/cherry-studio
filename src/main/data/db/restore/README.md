# DB Restore Promotion

Journal + preboot-promotion primitives for Backup v2's **whole-database replacement** ([backup §6](../../../../../docs/references/backup/README.md#6-journal-v2--promotion)).

The runtime never writes restored rows into the live database. `BackupService` admits an archive, materializes its database into a sealed file under `restore-staging/`, and writes a journal; the preboot gate then swaps that file in by atomic rename during the zero-connection window.

**No barrel** — consumers deep-import specific files (same convention as `src/main/core/preboot/`).

## Modules

| File | Exports | Role |
|---|---|---|
| `restoreJournalV2.ts` | `RestoreJournalV2(Schema)`, `PROMOTION_STEP_ORDER_V2`, `DB_COMMIT_STEP`, `parseRestoreJournalV2`, `readRestoreJournalV2` / `writeRestoreJournalV2` / `clearRestoreJournalV2` | Crash-safe journal contract (sidecar `restore-journal.json`, `feature.backup.restore.file`; MUST stay in the DB's directory — journal dir-fsyncs are what make a commit-step marker imply the DB rename is durable) |
| `restorePromotionV2.ts` | `runRestorePromotionV2`, `markRestoreFailedAfterCrashV2`, `isLiveDbStrandedV2` | The promotion itself: admission gate, forward execution, crash recovery |
| `restoreRecovery.ts` | `decideRecoveryAction`, `phaseForStep` | The pure `(direction, staged, live, aside)` → action table (§6.4); no I/O |
| `restoreGuard.ts` | `hasPendingRestore` | "Is a restore holding storage" — orphan sweep's stand-aside signal: non-terminal states **plus** a completed-but-unacknowledged one |
| `checkpoint.ts` | `checkpointTruncateAssert` | Asserted `wal_checkpoint(TRUNCATE)` — the live checkpoint (§6.2) and every artifact seal |
| `hashDbFile.ts` | `hashDbFile` | Streaming sha256 of a database main file (archive integrity) |
| `snapshot.ts` | `snapshotTo` | `VACUUM INTO` snapshot — the export's read-consistent copy |
| `appliedChain.ts` | `readAppliedChain` | The only legitimate source of a journal's `chain` |

`DbService.createSnapshot` / `DbService.checkpointTruncate` are readiness guards delegating to `snapshotTo` / `checkpointTruncateAssert` on the live connection.

## Journal state machine

```
prepared ──armed by the user──▶ armed ──gate passed──▶ promoting ──▶ completed
   │                                                       └───────▶ failed
   └──found unarmed at boot──▶ expired ◀──gate refused─────────────────┘
```

- `prepared` — written by `BackupService.prepareRestore`. **Not** permission to restore: cancellable, and a boot that merely stumbles over it **expires** it.
- `armed` — written durably immediately before `application.relaunch()`. The only state that enters promotion.
- `promoting` — set by the gate; `step` is the last **completed** step (see `PROMOTION_STEP_ORDER_V2`; ordering comparisons MUST use `indexOf` on that table, never string comparison).
- Markers are recovery hints, not ground truth: around the commit boundary the gate decides from filesystem reality via `restoreRecovery.ts`, plus the marker-lag probe (a landed commit rename with a lagging or unwritable marker resumes forward).
- Terminal states (`completed` / `failed` / `expired`) are kept for post-boot reporting; a `completed` one also holds GC protection until acknowledgement (§6.5).

## Promotion sequence

`gate-passed → live-checkpointed → resources-installed → sidecars-removed → live-aside → db-promoted → integrity-ok`

- **`live-checkpointed` is the first effectful step** (§6.2). v2 has no fingerprint, so this checkpoint is the only thing that proves the database about to be parked aside carries the user's last committed transactions — a rename moves the main file alone. It comes before any resource effect, so a checkpoint failure aborts having mutated nothing.
- **`db-promoted` is the commit point** (`DB_COMMIT_STEP`). Before it, recovery rolls back; at or after it, recovery goes forward.
- `resources-installed` is the Full-archive unified install (§6.3); Lite journals declare no entries and this build fails closed on any that appear.

## Ownership

| Artifact | Owner |
|---|---|
| `restore-journal.json` read/write primitives | this module |
| Journal state transitions during promotion | `restorePromotionV2.ts` (driven by the gate shell, `src/main/core/preboot/backupRestoreGate.ts`) |
| `restore-staging/` tree content (`feature.backup.restore.staging`) | BackupService before boot, the promotion afterwards (every terminal outcome drops it) |
| Terminal-journal deletion + aside cleanup | acknowledgement (§6.5) |
| Quarantined corrupt journals (`restore-journal.json.corrupt-<epoch>`) | kept for forensics alongside terminal journals |

## Writer requirements (preparation side)

Before writing a `prepared` journal:

1. **Seal the staged database**: `checkpointTruncateAssert` + `journal_mode=DELETE` + close, and prove no `-wal`/`-shm` remains (`services/backup/dbSeal.ts`). The gate renames the main file alone and **refuses** a staged database carrying a sidecar. Note that a later read-only open of a WAL-mode database re-creates its sidecars — sealing to DELETE mode is what makes reading the staged file harmless.
2. **`chain` MUST come from `readAppliedChain(staged)`** — never from the app's bundled migration list: drizzle's `migrate()` silently no-ops on an ahead-of-code database, so the bundled list can be a strict subset of what the database actually applied.
3. **Use userData-relative paths** for `promote` / `aside` (§6.6): `runUserDataRelocation()` copies the whole tree before the gate runs, and relative paths are what let a prepared restore survive it.
4. **Name the aside per restore.** Recovery decides from `(staged, live, aside)` existence, so a stale aside from an earlier restore mistaken for this one's rollback source is worse than no aside at all.
