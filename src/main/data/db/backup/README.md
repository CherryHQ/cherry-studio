# Backup neutral layer (`@main/data/db/backup/`)

Process-local neutral layer (data/schema-owned, **main-only**). Business domains
(topics / agents / knowledge / …) and the backup service import from here in the same
direction — this avoids data-domain contributors taking a reverse dependency on
`@main/services/backup/`, and keeps the `@shared` layer from growing (BackupDomain /
ConflictStrategy are main-only; the renderer passes primitive parameters and
`BackupService` converts them).

See `docs/references/backup/backup-architecture.md` §7 (placement / neutral layer) and
`openspec/.../contributor-framework.md` "contributor placement / 模块目录结构".

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
| `dbSchemaRefs.ts` | `@generated` product — `DB_TABLES` / `DB_COLUMNS_BY_TABLE` / `DB_PRIMARY_KEYS` / `DB_FOREIGN_KEYS` / `DB_FTS_VIRTUAL_TABLES` + `DbTableName` / `DbColumnName` brand types + `table()`/`column()`/`columns()` helpers. Never hand-edit. |
| `dbSchemaRefs.test.ts` | Product tests — membership, camelCase keys, PK heuristic (H1–H5), FK edge cases, FTS mapping |
| `scripts/generate-backup-schema-refs.ts` | The codegen — Drizzle runtime reflection (`getTableConfig`) over `src/main/data/db/schemas/`, biome-formatted emit. Run `pnpm backup:refs:generate`; verify with `pnpm backup:refs:check` (byte-equal, CI-enforced). |

### Track A1b — contributor type contracts

| File | Contents |
|------|----------|
| `contributor-types.ts` | Pure types — `BackupContributor` / `EntityGraphSchema` / `EntityReference` / `ReferenceKind` / `AggregateBoundary`+`AggregateMember` / `IdentityClass` / `BackupContributorPolicy` (OmittedReferenceOverride/UniqueMergeRule/FieldMergePolicy) / `BackupContributorOperations` (6 hooks) / `FileRefSourcePolicy` / `JsonSoftReferencePolicy` / `RowScope` + the `ReadonlyBackupRegistry` query interface. |
| `contexts.ts` | `BackupScopedDb` (drizzle wrapper, `allowedTables` write-boundary guard) / `BackupReadonlyDb` (select-only) / `ContributorWriteBoundaryViolationError` / `BackupContextBase` + 6 per-hook context subtypes / `RestoreResourceResult` / `BackupProgressEmitter` / `BackupPhase`. |
| `contexts.test.ts` | Tests — allowedTables guard (allow own / throw cross-domain on insert+update+delete), error payload, select-unrestricted, BackupReadonlyDb select-only. |

## TODO (later tracks — depend on codegen or upstream)

These are part of the plan but NOT in this change. Each will land in its own focused
change with convergence review.

| File / module | Track | Status / blocker |
|----|----|----|
| eslint `no-restricted-syntax` guard | (defer) | spec codegen.md L199 / types-contracts L87: ban hand-editing `@generated` files + ban `'x' as DbTableName` / `as DbColumnName` casts. Deferred until the first real consumer: the rule needs file-specific `overrides` (a blanket `Program:has(DB_TABLES)` selector would also flag files that merely import `DB_TABLES`). Lands with the first contributor (A3). |
| `contributors/` + `ContributorManager` + `finalize` | A3 / B | 14-domain contributor declarations + non-lifecycle singleton + 25-invariant finalize. Depends on A1 + A2 + A1b (✓ done). |
| orchestrator / `BackupService` / `RestoreSafetyManager` | C / D / E | Export / restore / safety. **Blocked on upstream gating** (DbService `restoreDbFromSnapshot` / `verifyLiveDb` / `withExclusiveAccess`, PreferenceService `reloadFromDb` / `armWriteGate`, lifecycle `@WriteSilenceable` decorators, business-Service restore hooks) — see `/Users/gd32/Downloads/backup-upstream-issues/`. |
