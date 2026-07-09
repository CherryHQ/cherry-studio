import type { FileRefSourceType } from '@shared/data/types/file'

// Backup neutral layer — global exclusion-set constants.
//
// These are global (non-domain-specific) table-exclusion sets, NOT domain business
// facts, so they live in the neutral layer (same layer as the codegen product
// dbSchemaRefs.ts but hand-written, not generated). ContributorManager / finalize and
// the coverage test import them from here (tier-1 M9: single ownership, no duplication
// across ContributorManager / registry / coverage).
//
// Membership model: __drizzle_migrations is IN INFRASTRUCTURE_TABLES
// but NOT in DB_TABLES (codegen only discovers sqliteTable() calls), so the coverage
// equation (which iterates DB_TABLES) never involves it — it is a VACUUM-INTU-preserved
// infrastructure artifact outside the coverage universe.

/**
 * Physical tables stripped from every backup (never owned by any contributor).
 * - app_state: runtime process state (seed journal, caches) — not user data.
 * - job: runtime job queue — not user data.
 *
 * These ARE in DB_TABLES (codegen discovers sqliteTable() calls), so the stripper's
 * DB_TABLES whitelist admits them directly.
 *
 * finalize invariant #4 asserts no contributor owns these.
 */
export const ALWAYS_STRIP_PHYSICAL_TABLES: readonly string[] = ['app_state', 'job']

/**
 * FTS5 virtual tables — NOT independently stripped on export. They are external-content
 * tables (e.g. `message_fts` is `content='message'`), so their index is BOUND to the
 * content table: `DELETE FROM message_fts` does NOT clear the shadow index while the
 * message rows remain, and dropping the virtual table would break migrate-forward
 * schema expectations. The producer's FTS shadow data therefore travels with the
 * archived message rows; CORRECTNESS is restored by running the FTS5 `'rebuild'`
 * command against the merged content tables on the target (repopulates a fresh index).
 *
 * Listed here (and folded into ALWAYS_STRIP_TABLES) so finalize invariant #4 can
 * assert no contributor owns them, and so the coverage test excludes them.
 * - message_fts: message full-text index (external-content, content='message').
 * - agent_session_message_fts: agent-session message full-text index.
 */
export const ALWAYS_STRIP_FTS_VIRTUAL_TABLES: readonly string[] = ['message_fts', 'agent_session_message_fts']

/**
 * Union of physical + FTS virtual tables stripped from every backup.
 * Kept for finalize invariant #4 (no contributor owns these) + the coverage test
 * (excludes them from the domain-owned universe). Consumers read this as a Set —
 * the PHYSICAL / FTS split above only serves the stripper's two-part whitelist.
 */
export const ALWAYS_STRIP_TABLES: ReadonlySet<string> = new Set<string>([
  ...ALWAYS_STRIP_PHYSICAL_TABLES,
  ...ALWAYS_STRIP_FTS_VIRTUAL_TABLES
])

/**
 * Infrastructure tables preserved in backup.sqlite for migrate-forward correctness
 * (VACUUM INTO copies them), but excluded from domain conflict policy. Not owned by
 * any contributor; not part of the coverage universe (∉ DB_TABLES).
 *
 * - __drizzle_migrations: Drizzle migration state. Preserved so the restore-time
 *   migrate-forward can detect producer migration position and apply only the delta.
 */
export const INFRASTRUCTURE_TABLES: ReadonlySet<string> = new Set<string>(['__drizzle_migrations'])

/**
 * FileRef sourceTypes that are runtime-only (in-memory, no DB rows to back up) —
 * excluded from the backup universe. finalize invariant #11 treats these as
 * covered (runtime-only-exclude, backup-architecture §8.5 invariant #11) so they need no
 * contributor owner.
 *
 * - temp_session: runtime temp-session refs live in CacheService (no table) —
 *   architecture L193 (temp_session ref becomes in-memory-only) + L283 (excluded at runtime).
 */
export const RUNTIME_EXCLUDED_FILE_REF_SOURCES: readonly FileRefSourceType[] = ['temp_session']
