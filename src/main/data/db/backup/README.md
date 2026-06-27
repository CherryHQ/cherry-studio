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

## TODO (later tracks — depend on codegen or upstream)

These are part of the plan but NOT in this change. Each will land in its own focused
change with convergence review.

| File / module | Track | Status / blocker |
|----|----|----|
| eslint `no-restricted-syntax` guard | A1b | spec codegen.md L199 / types-contracts L87: ban hand-editing `@generated` files + ban `'x' as DbTableName` / `as DbColumnName` casts. **Deferred to A1b**: the rule needs file-specific `overrides` (a blanket `Program:has(DB_TABLES)` selector would also flag consumers that merely import `DB_TABLES`), so it lands with the first real consumer. |
| `contributor-types.ts` | A1b (ready) | Pure types (`BackupContributor` / `EntityGraphSchema` / `EntityReference` / `AggregateBoundary` / `PrimaryKeyFact` / `BackupContributorPolicy`). Depends on `DbTableName` / `DbColumnName` from `dbSchemaRefs.ts` (A2 ✓ done) — now unblocked. |
| `contexts.ts` | A1b (ready) | Typed hook contexts (`BackupScopedDb` / `BackupReadonlyDb` / `BackupContextBase` + per-hook subtypes, `allowedTables` write-boundary guard). Depends on `dbSchemaRefs.ts` (A2 ✓) + `DbOrTx` — now unblocked. |
| `contributors/` + `ContributorManager` + `finalize` | A3 / B | 14-domain contributor declarations + non-lifecycle singleton + 25-invariant finalize. Depends on A1 + A2 (✓ done). |
| orchestrator / `BackupService` / `RestoreSafetyManager` | C / D / E | Export / restore / safety. **Blocked on upstream gating** (DbService `restoreDbFromSnapshot` / `verifyLiveDb` / `withExclusiveAccess`, PreferenceService `reloadFromDb` / `armWriteGate`, lifecycle `@WriteSilenceable` decorators, business-Service restore hooks) — see `/Users/gd32/Downloads/backup-upstream-issues/`. |
