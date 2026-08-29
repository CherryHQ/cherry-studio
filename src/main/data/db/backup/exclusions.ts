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
 * - ai_usage_record: cost-analytics usage aggregates (#15992) — derivable, not user data.
 *
 * These ARE in DB_TABLES (codegen discovers sqliteTable() calls), so the stripper's
 * DB_TABLES whitelist admits them directly.
 *
 * finalize invariant #4 asserts no contributor owns these.
 */
export const ALWAYS_STRIP_PHYSICAL_TABLES: readonly string[] = [
  'app_state',
  'job',
  // job_file_ref.sourceId → job (cascade). `job` is runtime (image-job queue, ALWAYS_STRIP),
  // so job_file_ref is its runtime附属: its purpose is to keep a running job's input bytes
  // alive (anti-reclaim). With no `job` row surviving into backup, the ref has no owner to
  // hang off and would dangle. Stripped together with job.
  'job_file_ref',
  'ai_usage_record'
]

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
 * Empty today: the previous `temp_session` sourceType was removed when the FileRefSchema
 * union was narrowed to the 6 on-disk ref tables (chat_message / agent_session_message /
 * painting / job / provider_logo / mini_app_logo). Each of those is now backed by a real
 * sqliteTable and owned by a contributor (or runtime-excluded via ALWAYS_STRIP, like `job`).
 * Kept as an empty typed array so the runtime-only-exclude contract is still expressible
 * should a future in-memory sourceType reappear.
 */
export const RUNTIME_EXCLUDED_FILE_REF_SOURCES: readonly FileRefSourceType[] = []
