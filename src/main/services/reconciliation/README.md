# Reconciliation Engine

This package reconciles two SQLite databases into one: a read-only **source** is merged into a
writable **target** inside a single synchronous transaction, with identity propagation, junction
resolution, polymorphic-association rewriting, dangling-reference repair, and FTS integrity.

It is **not** a backup module. Backup restore is its first consumer; a future cross-device sync
consumer is the second. Both call the engine through the barrel (`./index.ts`); internal modules
stay private.

> **Placement rationale** (full reasoning in `.trellis/tasks/08-08-reconcile-layer-positioning/prd.md` §3):
> this lives under `services/` because main-process-architecture §3 names `services/` as the shared
> tier feature domains reach through. The engine is business logic with outward side effects (writes
> SQLite), not storage-layer code, so it does not belong under `data/`. The `rollbackCore` precedent
> (`data/db/backup/recovery/` was rejected as scope creep into the neutral layer) applies.

---

## 1. Module ownership

| Module | Belongs here? | Why |
|---|---|---|
| `MergeEngine` | ✅ reconciliation-generic | The merge core: aggregate boundaries, cascade, identity propagation, junction, polymorphic, JSON-FK rewrite, dangling repair, FTS |
| `junctionDeriver` | ✅ | Derives junction-table descriptors from the registry |
| `polymorphicAssociationDeriver` | ✅ | Derives polymorphic-association descriptors |
| `ftsCentral` | ✅ | FTS rebuild + integrity assertions |
| `platformSpecificKeyMatch` | ✅ | Pure glob matcher for PREFERENCES platform-key exclusion (zero imports, patterns come from the registry) |
| `types` | ✅ | Engine vocabulary (`MergeContext`, `MergeResult`, `ReconcileDegradationKind`, …) |
| `resourcePlanning` / `manifest` / `restorePromotion` / `restoreJournal` / `notesMergedTree` / `notesTreeHash` | ❌ restore-specific | Live in `services/backup/`; they carry archive/restore-journal concepts the engine has no opinion on |

---

## 2. The shared/backup boundary inside `contributorTypes.ts`

The engine's registry vocabulary lives in `src/main/data/db/backup/contributorTypes.ts` (471 lines).
That file is itself split into **four segments** — only segments 1, 3 (partly), and 4 are safe for a
non-backup consumer. Segment 2 is backup-lifecycle hooks and must never be imported here.

| Segment | Lines | Section marker | Verdict | Exports |
|---|---|---|---|---|
| **1** | `:20-192` | `// ─── Reference + identity classification ───` | **shared** (entity-graph vocabulary) | `ReferenceKind`, `IdentityClass`, `JsonSoftRefKind`, `EntityReference`, `AggregateMember`, `AggregateBoundary`, `RowScope`, `FileRefSourcePolicy`, `JsonSoftReferencePolicy`, `JsonEntityIdSelector`, `OmittedReferenceOverride`, `UniqueMergeRule`, `FieldMergePolicy` |
| **2** | `:193-356` | `// ─── Hook context interfaces ───` | **backup-only** (lifecycle hooks) | `BackupPhase` (incl. `'collect'`/`'archive'` — export-only concepts), `BackupProgressEmitter`, `BackupContextBase`, `ResourceDescriptor`, `ExportResourceDegradation`, `FileResourceContext`, `BeforeArchiveContext`, `RowTransformContext`, `AfterImportContext`, `RestoreResourceResult`, `RestoreResourceContext`, `CloneAggregateContext` |
| **3** | `:357-438` | `// ─── Contributor schema + policy + operations ───` | **mixed** — see below | `EntityGraphSchema` (shared), `BackupContributorPolicy` (shared — 4 reconcile-strategy fields, zero lifecycle content), `BackupContributorOperations` (mixed — `transformRow`/`afterImport`/`cloneAggregate` are reconcile; `collectFileResources`/`beforeArchive`/`restoreResources` are backup), `BackupContributor` (composite) |
| **4** | `:439-471` | `// ─── ReadonlyBackupRegistry ───` | **shared** | `ReadonlyBackupRegistry` (the read-only entity-graph query interface — the engine's main dependency) |

**Why segment 3's `BackupContributorPolicy` is shared despite its name**: its 4 fields are all
reconcile strategies (`omittedReferenceOverrides`, `uniqueMergeRules`, `fieldMergePolicies`,
`platformSpecificKeys`). There is zero backup-lifecycle content. The `Backup*` name is a known debt
(see §4), not a semantic signal.

**What the engine actually imports** (verified): `AggregateBoundary`, `EntityReference`,
`FieldMergePolicy`, `JsonSoftReferencePolicy`, `ReadonlyBackupRegistry` (from `MergeEngine` +
`types`). All on the shared side. The boundary assertion test (see §6 / `__tests__/boundary.test.ts`)
enforces this stays true.

> S-4 (sync seam, §3): the three reconcile hooks in `BackupContributorOperations`
> (`transformRow`/`afterImport`/`cloneAggregate`) carry contexts that `extends BackupContextBase`,
> and `BackupContextBase` holds `restoreId` — a backup-only field. A sync consumer would need a
> neutral context base or its own hook contract. Left unchanged today: backup is the only consumer,
> so there is nothing to validate a change against.

---

## 3. Sync seams — what a cross-device consumer must add

The engine is **single-directional** (source read-only, no write-back path). That is the correct
primitive granularity, not a limitation: bidirectional sync = the sync layer orchestrating two
single-direction passes (peer→local, local→peer) plus causality deciding what each pass sends. The
engine's job — "correctly land a batch of foreign rows into this DB" — is exactly the reusable layer.

> ⚠️ **S-1 is a prerequisite for bidirectional, not an optional optimization.** Running two
> single-direction passes without resolving causality ping-pongs (both sides overwrite each other
> forever). Anyone who thinks "run it twice = bidirectional" has not read this. **Do not remove this
> warning.**

| # | Seam | Location | What sync must add |
|---|---|---|---|
| **S-1** | Conflict-strategy defaults are hard-coded to restore semantics: `agg.conflictDefault ?? (naturalKey ? 'FIELD_MERGE' : 'SKIP')` (uuid → SKIP = local wins). The override entry `ctx.userStrategy` is **global**, not per-aggregate. `OVERWRITE`/`RENAME` currently throw `MergeStrategyNotImplementedError`. | `MergeEngine.ts`, anchor `if (ctx.userStrategy === 'OVERWRITE'` and `const conflictDefault = agg.conflictDefault ??` | A per-aggregate strategy set + a timestamp-aware strategy (the 4 `ConflictStrategy` values `SKIP`/`OVERWRITE`/`RENAME`/`FIELD_MERGE` have no "newer wins"). **The mechanism exists; the default and the granularity do not.** |
| **S-2** | No deletion path at all (the frozen baseline §30 explicitly excludes set-difference deletion). | globally absent | Tombstones (require a schema migration). **Before that lands, any "sync delete" implementation is wrong.** |
| **S-3** | `IdentityMap` is engine-internal — the comment says "built in `mergeBackupIntoWork`, not passed by the caller". | `types.ts`, anchor `export interface IdentityMap` + the `MergeContext` doc comment | An injectable/exportable identityMap + a `deviceId` (zero matches repo-wide). The seam is located: make identityMap a ctx-optional injection + a result export. |
| **S-4** | Reconcile hooks carry backup-shaped contexts (see §2). | `contributorTypes.ts:296/314/348` + `:212` | A neutral context base, or sync's own hook contract. Unchanged today. |

---

## 4. Naming debt (registered, not renamed)

Several types have `Backup*` names but are semantically neutral. **Decision (2026-08-09): do not
rename in this pass.** ~240 sites / ~30 files of mechanical churn would bury the structural change.
The boundary is pinned to file:line above, so the wrong name does not cause execution errors.

**Rename when**: a sync consumer lands and asks for it (demand-first). The targets, with measured
footprint so the future task is mechanical not discovery:

| Current name | Target | Footprint |
|---|---|---|
| `BackupDomain` | `DataDomain` | 133 sites / 17 files |
| `ReadonlyBackupRegistry` | `ReadonlyEntityGraphRegistry` | 37 sites / 13 files |
| `BackupContributor` | `EntityGraphContributor` | 57 sites / 23 files |
| `BackupScopedDb` | `ScopedDb` | 13 sites / 3 files |
| `MergeContext.backupDbPath` | `sourceDbPath` | 1 site |
| `skippedFileEntryIds` / `stagedFileEntryIds` / `skippedKnowledgeBaseIds` / `skippedSkillFolderNames` | content-availability naming | 4 fields |

> **Known cost (stated plainly, so "decoupled" is not over-read)**: a sync consumer will import types
> named `Backup*`. **Functionally complete; not yet neutral-named.**

---

## 5. The 27 finalize invariants — schema contract vs restore semantics

`ContributorManager.finalize()` validates 27 invariants before building the registry. Each is judged:
does it validate **schema structure itself** (holds for any consumer), or does it depend on
**restore/merge behavior semantics** (holds under restore's conflict model)?

**Pure schema contract** (hold for any consumer — a sync layer can rely on them unchanged):

| # | What it checks | Why schema-only |
|---|---|---|
| 1 | Exactly one contributor per domain; the set is the 14 `BACKUP_DOMAINS` | Domain-set completeness — a structural partition |
| 2 | Owned tables ∈ `DB_TABLES` | Codegen fact check |
| 3 | No table multi-owned | Ownership partition |
| 4/5 | `ALWAYS_STRIP`/`INFRASTRUCTURE` tables never contributor-owned | Exclusion-set integrity |
| 6 | A reference's source table belongs to the declaring owner; `referencedDomain` matches the FK target's owner | FK-graph structural fact |
| 8 | Every owned table has a PK fact; columns are real | Codegen existence |
| 9 | PK is non-ambiguous | Schema fact |
| 11 | Every `FileRefSourceType` is owned or runtime-excluded | Source-type completeness — cross-consumer |
| 13 | Aggregate boundary: root owned, identityKey real, natural-key/slot identityKey backed by a real UNIQUE | Uniqueness is a codegen fact |
| 14 | Each member derives from an in-domain OWNING reference; member→parent chain acyclic | FK cascade derivation |
| 15 | Member tables owned; `viaColumn` is a real FK bound to root/parent | Codegen FK fact |
| 19 | `EntityReference.kind` matches the FK `onDelete` policy | onDelete is a codegen FK fact |
| 22 | PK is not `autoincrement` | Schema fact — also a sync enabler (no auto-int collisions) |
| 23 | `rowScopes` filter column real; `typeCoverage` consistent | Shared-table row ownership partition |
| 24 | A declared reference corresponds to a generated FK | Codegen correspondence |
| 25 | Every DB FK on an owned table is declared by its owner | FK exhaustiveness — codegen fact |

**Implementation contract** (not schema, not behavior — internal discipline):

| # | What it checks | Why implementation-only |
|---|---|---|
| 17 | Each contributor constant is deep-frozen at load | Immutability discipline |
| 18 | A violation carries a locator payload | Error contract |

**Depends on restore/merge semantics** (hold under restore's conflict model — a sync consumer must
re-confirm they match its model):

| # | What it checks | Why restore-coupled |
|---|---|---|
| 7 | `omittedReferenceOverrides` bind a declared ref, are non-redundant, and are reasoned | Omitted-reference handling is restore's dangling-ref repair behavior |
| 16 | A renamable aggregate supplies `cloneAggregate` | RENAME is a merge conflict strategy; `cloneAggregate` is a restore behavior hook |
| 21 | Natural-key/slot aggregates must not default to SKIP (settings exempt); `platformSpecificKeys` globs are legal + PREFERENCES-only; `polymorphicEntityMap` values are known domains | `conflictDefault` is the merge strategy default (= seam S-1); `platformSpecificKeys` is a merge-exclusion pattern |
| 26 | A renamable aggregate has a single-column root PK | Single-column PK is schema, but `renamable` is a restore concept (the constraint exists only because rename replaces one PK column) |

**Mixed** (structural core + behavior precondition):

| # | What it checks | Why mixed |
|---|---|---|
| 10 | The references-derived domain dependency graph is acyclic (Kahn) | The graph is schema-derived; acyclicity is a *merge import-order* precondition (topo sort drives who imports first) |
| 12 | `jsonSoftReferences` bidirectional subset + entity-id selector well-formedness | The declared⊆`DB_JSON_COLUMNS` subset is schema; the entity-id walker validation (targetTable is a single-column-PK aggregate root, selectors carry idField) assumes the `identityMap` seeding mechanism = merge behavior |
| 20 | A junction reference's FK must cascade; an optional reference on a NOT NULL column needs an override | Cascade is schema; the NOT NULL + override guard is a restore dangling-handling precondition |
| 27 | `junctionRole` only on junction-phase tables, exactly one source + one target | Junction topology is schema; `junctionRole` is a precondition of the merge junction-resolution phase |

> **Bottom line**: 17 pure-schema + 2 implementation + 4 restore-coupled + 4 mixed. The 4
> restore-coupled and the behavior halves of the 4 mixed are the ones a sync consumer must
> re-validate against its own model. The 17 pure-schema invariants are the engine's stable spine.

---

## 6. Barrel + boundary-enforcement notes

- The barrel (`index.ts`) exports exactly: `MergeEngine`, `MergeStrategyNotImplementedError`,
  `MergeContext`, `MergeResult`, `ReconcileDegradationKind`. Consumers enter through it; deep imports
  into internal modules are forbidden.
- `__tests__/boundary.test.ts` asserts every source file's imports from `contributorTypes` stay
  inside the shared whitelist (16 symbols). If someone adds a hook type to the shared side, or lets
  the engine import `BackupContextBase`/`BackupPhase`/`RowTransformContext`, **the test goes red** —
  not a silent review miss.
- **Tension on record**: main process has no `import/no-restricted-paths` zone (main-process-
  architecture §3 states the internal direction edge is "held by convention and review"; only the
  renderer has an enforced zone). CLAUDE.md says "don't erect a barrel you can't seal"; §2.1 of the
  main-process doc is the main-specific authority that *does* require `index.ts`. We follow §2.1 and
  record the tension here. The boundary test is the partial substitute for a lint zone on the main side.
