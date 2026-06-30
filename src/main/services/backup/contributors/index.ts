// Backup contributors barrel — ContributorManager + finalize + the read-only
// registry view + the CONTRIBUTORS barrel that aggregates the domain contributor
// declarations.
//
// Per backup-architecture §7 / contributor-framework "placement", the domain
// contributor declarations live in their OWNING domain modules (not here); this
// module only aggregates them into the CONTRIBUTORS barrel that
// ContributorManager + the coverage test consume. The barrel is the single
// import surface for "all backup contributors".

import { PREFERENCES_CONTRIBUTOR } from '@main/data/backupContributor-preferences'
import type { BackupContributor } from '@main/data/db/backup/contributor-types'
import { ASSISTANTS_CONTRIBUTOR } from '@main/data/services/backupContributor-assistants'
import { MCP_SERVERS_CONTRIBUTOR } from '@main/data/services/backupContributor-mcp-servers'
import { PROMPTS_CONTRIBUTOR } from '@main/data/services/backupContributor-prompts'
import { SKILLS_CONTRIBUTOR } from '@main/data/services/backupContributor-skills'
import { TAGS_GROUPS_CONTRIBUTOR } from '@main/data/services/backupContributor-tags-groups'
import { TRANSLATE_HISTORY_CONTRIBUTOR } from '@main/services/translate/backupContributor'

export type { ContributorFinalizePayload } from './ContributorFinalizeError'
export { ContributorFinalizeError } from './ContributorFinalizeError'
export { ContributorManager, contributorManager } from './ContributorManager'
export { finalize } from './finalize'
export type { FinalizedRegistryData } from './ReadonlyBackupRegistryImpl'
export { CircularReferenceError, READONLY_REGISTRY, ReadonlyBackupRegistryImpl } from './ReadonlyBackupRegistryImpl'

// Re-export the domain contributor constants so consumers can reach an individual
// contributor without knowing its owning-module path.
export {
  ASSISTANTS_CONTRIBUTOR,
  MCP_SERVERS_CONTRIBUTOR,
  PREFERENCES_CONTRIBUTOR,
  PROMPTS_CONTRIBUTOR,
  SKILLS_CONTRIBUTOR,
  TAGS_GROUPS_CONTRIBUTOR,
  TRANSLATE_HISTORY_CONTRIBUTOR
}

/**
 * The contributor barrel — every BackupContributor the backup system knows.
 *
 * Wave 1 (7 stable domains): PREFERENCES, PROMPTS, MCP_SERVERS, TAGS_GROUPS,
 * ASSISTANTS, SKILLS, TRANSLATE_HISTORY.
 *
 * Wave 2 (pending — blocked on in-flight schema PRs, see
 * ~/Downloads/backup-schema-status-2026-06-30.md): PROVIDERS, AGENTS, MINIAPPS,
 * TOPICS, KNOWLEDGE, PAINTINGS, FILE_STORAGE.
 *
 * Finalize invariant #1 requires registry.length === 14, so ContributorManager is
 * NOT yet wired with this barrel (the singleton stays default-empty; getRegistry()
 * would fail at #1). The coverage test consumes CONTRIBUTORS directly and tracks
 * the Wave-2 gap. Once all 14 land, ContributorManager's TODO(B) wires
 * `new ContributorManager(CONTRIBUTORS)`.
 */
export const CONTRIBUTORS: readonly BackupContributor[] = [
  PREFERENCES_CONTRIBUTOR,
  PROMPTS_CONTRIBUTOR,
  MCP_SERVERS_CONTRIBUTOR,
  TAGS_GROUPS_CONTRIBUTOR,
  ASSISTANTS_CONTRIBUTOR,
  SKILLS_CONTRIBUTOR,
  TRANSLATE_HISTORY_CONTRIBUTOR
]
