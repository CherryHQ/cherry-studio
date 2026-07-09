# Backup neutral layer (`@main/data/db/backup/`)

Process-local neutral layer (data/schema-owned, **main-only**). Business domains
(topics / agents / knowledge / …) and the backup service import from here in the same
direction — this avoids data-domain contributors taking a reverse dependency on
`@main/services/backup/`, and keeps the `@shared` layer from growing (BackupDomain /
ConflictStrategy are main-only; the renderer passes primitive parameters and
`BackupService` converts them).

See `docs/references/backup/backup-architecture.md` §7 (placement / neutral layer).

## Implemented

### Track A1 — zero-dependency basics

| File | Contents |
|------|----------|
| `domains.ts` | `BackupDomain` (14 domains) + `ConflictStrategy` enums, main-only |
| `freeze.ts` | `deepFreeze` helper — freezes contributor constant objects at load |
| `exclusions.ts` | `ALWAYS_STRIP_TABLES` / `INFRASTRUCTURE_TABLES` global exclusion sets |

### Track A2 — schema-refs codegen

| File | Contents |
|------|----------|
| `dbSchemaRefs.ts` | `@generated` product — `DB_TABLES` / `DB_COLUMNS_BY_TABLE` / `DB_PRIMARY_KEYS` / `DB_FOREIGN_KEYS` / `DB_UNIQUE_KEYS` / `DB_FTS_VIRTUAL_TABLES` + `DbTableName` / `DbColumnName` / `UniqueKeyFact` brand types + `table()`/`column()`/`columns()`/`mirrorPk()` helpers. Never hand-edit. |
| `dbSchemaRefs.test.ts` | Product tests — membership, camelCase keys, PK heuristic (H1–H5), FK edge cases, unique-key coverage (single/composite/partial/expression), FTS mapping |
| `scripts/generate-backup-schema-refs.ts` | The codegen — Drizzle runtime reflection (`getTableConfig`) over `src/main/data/db/schemas/`, biome-formatted emit. Run `pnpm backup:refs:generate`; verify with `pnpm backup:refs:check` (byte-equal, CI-enforced). |

### Track A1b — contributor type contracts

| File | Contents |
|------|----------|
| `contributor-types.ts` | Pure types — `BackupContributor` / `EntityGraphSchema` / `EntityReference` / `ReferenceKind` / `AggregateBoundary`+`AggregateMember` / `IdentityClass` / `BackupContributorPolicy` (OmittedReferenceOverride/UniqueMergeRule/FieldMergePolicy) / `BackupContributorOperations` (6 hooks) / `FileRefSourcePolicy` / `JsonSoftReferencePolicy` / `RowScope` / hook context interfaces (`BackupContextBase` + 6 per-hook subtypes / `RestoreResourceResult` / `BackupProgressEmitter` / `BackupPhase`) + the `ReadonlyBackupRegistry` query interface. |
| `contexts.ts` | `BackupScopedDb` (drizzle wrapper, `allowedTables` write-boundary guard) / `BackupReadonlyDb` (select-only) / `ContributorWriteBoundaryViolationError`. |
| `__tests__/contexts.test.ts` | Tests — allowedTables guard (allow own / throw cross-domain on insert+update+delete), error payload, select-unrestricted, BackupReadonlyDb select-only. |

## TODO (later tracks — depend on codegen or upstream)

These are part of the plan but NOT in this change. Each will land in its own focused
change with convergence review.

| File / module | Track | Status / blocker |
|----|----|----|
| ~~eslint `no-restricted-syntax` guard~~ | ✅ done (track-A3, lands in the manager PR) | `eslint.config.mjs` bans `as DbTableName` / `as DbColumnName` casts in `src/main/services/backup/contributors/**` (non-test) via a `TSAsExpression > TSTypeReference > Identifier[name]` selector — forces the codegen `table()` / `column()` helpers so typos fail at compile time. Hand-editing `@generated` files is guarded separately by `pnpm backup:refs:check` (byte-equal, CI-enforced). |
| `ContributorManager` + `finalize` + `ReadonlyBackupRegistry` | A3 (manager PR #16683) | `src/main/services/backup/contributors/` — non-lifecycle singleton + 26-invariant finalize + read-only registry (derived-filled aggregates, codegen PK/FK facts, Kahn topoSort). This PR ships only the `ReadonlyBackupRegistry` query interface (in `contributor-types.ts`); the manager + finalize land in the manager PR. The 14-domain CONTRIBUTORS barrel is the B track. |
| 14 contributors + `CONTRIBUTORS` barrel | B | The real domain declarations wired into `contributorManager`. Depends on A (✓ done); `operations` hooks touch business Services (upstream) and stay TODO within B. |
| orchestrator / `BackupService` (D model supersedes `RestoreSafetyManager`) | C / D | Export / restore. **D model**: runtime detached merge into `work.sqlite` + preboot atomic promotion (`RestoreSafetyManager` / runtime rollback entirely removed — safety is structural via the preboot promotion gate + restart; see backup-architecture §9). **Blocked on upstream gating**: DbService `createSnapshot` / `applyMigrations` / **preboot promotion gate** + per-module write-quiesce interfaces (tracked in upstream issues). |
