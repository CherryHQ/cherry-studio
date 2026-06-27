// Backup neutral layer — BackupDomain / ConflictStrategy enums (main-only).
//
// These enums are main-process-only: the renderer never imports them. The renderer
// passes simple primitive parameters (preset: 'full' | 'lite', strategy: 'rename' |
// 'overwrite') and BackupService converts them to these enums — therefore the enums
// do NOT belong in @shared (see backup-architecture.md / contributor-framework.md
// "BackupDomain 枚举与预设映射来源").

/**
 * The 14 backup domains. Each domain is owned by exactly one BackupContributor
 * (finalize invariant #1: registry.length === 14). Adding a domain requires a new
 * contributor + this union updated.
 *
 * Lite preset (10): PREFERENCES / PROVIDERS / PROMPTS / MCP_SERVERS / TAGS_GROUPS /
 * ASSISTANTS / AGENTS / MINIAPPS / SKILLS / TOPICS.
 * Excluded from lite (4): KNOWLEDGE / PAINTINGS / FILE_STORAGE / TRANSLATE_HISTORY
 * (large blobs / history — not exported in lite mode).
 */
export type BackupDomain =
  | 'PREFERENCES'
  | 'PROVIDERS'
  | 'PROMPTS'
  | 'MCP_SERVERS'
  | 'TAGS_GROUPS'
  | 'ASSISTANTS'
  | 'AGENTS'
  | 'MINIAPPS'
  | 'SKILLS'
  | 'TOPICS'
  | 'KNOWLEDGE'
  | 'PAINTINGS'
  | 'FILE_STORAGE'
  | 'TRANSLATE_HISTORY'

/**
 * Restore conflict strategy for an aggregate.
 * - SKIP: keep local, ignore backup row (default for uuid-entity aggregates).
 * - OVERWRITE: row-level replace — identityKey-matching member rows fully overwritten,
 *   local-only members preserved (no差集 deletion).
 * - RENAME: keep both sides (only for renamable:true aggregates; degrades to SKIP + notify).
 * - FIELD_MERGE: field-level merge (default for natural-key/slot aggregates, e.g. PROVIDERS
 *   keeps local API key + merges remote).
 *
 * Renderer passes only 'rename' | 'overwrite' (user intent); BackupService resolves the
 * aggregate-level strategy (combines user override + identityClass default).
 */
export type ConflictStrategy = 'SKIP' | 'OVERWRITE' | 'RENAME' | 'FIELD_MERGE'
