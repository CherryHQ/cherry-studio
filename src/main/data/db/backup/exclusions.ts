// Backup neutral layer — global exclusion-set constants.
//
// These are global (non-domain-specific) table-exclusion sets, NOT domain business
// facts, so they live in the neutral layer (same layer as the codegen product
// dbSchemaRefs.ts but hand-written, not generated). ContributorManager / finalize and
// the coverage test import them from here (tier-1 M9: single ownership, no duplication
// across ContributorManager / registry / coverage).
//
// Membership model (codegen.md L32-36): __drizzle_migrations is IN INFRASTRUCTURE_TABLES
// but NOT in DB_TABLES (codegen only discovers sqliteTable() calls), so the coverage
// equation (which iterates DB_TABLES) never involves it — it is a VACUUM-INTU-preserved
// infrastructure artifact outside the coverage universe.

/**
 * Tables stripped from every backup (never owned by any contributor).
 * - app_state: runtime process state (seed journal, caches) — not user data.
 * - job: runtime job queue — not user data.
 * - message_fts / agent_session_message_fts: FTS5 virtual tables — rebuilt post-restore
 *   from their content tables (see DB_FTS_VIRTUAL_TABLES in dbSchemaRefs.ts — track A2,
 *   not yet generated), never exported verbatim.
 *
 * finalize invariant #4 asserts no contributor owns these.
 */
export const ALWAYS_STRIP_TABLES: ReadonlySet<string> = new Set<string>([
  'app_state',
  'job',
  'message_fts',
  'agent_session_message_fts'
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
