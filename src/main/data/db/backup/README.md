# Backup neutral layer (`@main/data/db/backup/`)

Process-local neutral layer (data/schema-owned, **main-only**). Business domains
(topics / agents / knowledge / …) and the backup service import from here in the same
direction — this avoids data-domain contributors taking a reverse dependency on
`@main/services/backup/`, and keeps the `@shared` layer from growing (BackupDomain /
ConflictStrategy are main-only; the renderer passes primitive parameters and
`BackupService` converts them).

See `docs/references/backup/backup-architecture.md` §7 (placement / neutral layer).

## Implemented (this PR / track-a)

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
| `__tests__/dbSchemaRefs.test.ts` | Product tests — membership, camelCase keys, PK heuristic (H1–H5), FK edge cases, unique-key coverage (single/composite/partial/expression), FTS mapping |
| `scripts/generate-backup-schema-refs.ts` | The codegen — Drizzle runtime reflection (`getTableConfig`) over `src/main/data/db/schemas/`, biome-formatted emit. Run `pnpm backup:refs:generate`; verify with `pnpm backup:refs:check` (byte-equal, CI-enforced). |

### Track A1b — contributor type contracts

| File | Contents |
|------|----------|
| `contributor-types.ts` | Pure types — `BackupContributor` / `EntityGraphSchema` / hook context interfaces (`BackupContextBase` + per-hook subtypes) + `ReadonlyBackupRegistry` query interface. D-model JSDoc on `AfterImportContext` / `RestoreResourceContext`. |
| `contexts.ts` | `BackupScopedDb` (drizzle wrapper, `allowedTables` write-boundary guard) / `BackupReadonlyDb` (select-only) / `ContributorWriteBoundaryViolationError`. |
| `__tests__/contexts.test.ts` | Tests — allowedTables guard, error payload, select-unrestricted, BackupReadonlyDb select-only. |

## Later stack PRs (not in track-a)

| File / module | Track | Status / blocker |
|----|----|----|
| eslint `no-restricted-syntax` guard + `ContributorManager` + `finalize` | A3 | Lands in later stack PRs (`backup-manager` series). |
| 14 contributors + `CONTRIBUTORS` barrel | B | Domain declarations in `backup-contributors` / `backup-core-contributors`. |
| Export / restore orchestrator (`BackupService`) | C / D | Export skeleton in `backup-manager`. **Restore** blocked on upstream: DbService `createSnapshot` / `applyMigrations` / **preboot promotion gate** + write-quiesce (#16714). D model: detached merge into `work.sqlite` + preboot atomic promotion. |
