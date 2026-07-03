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
import { AGENTS_CONTRIBUTOR } from '@main/data/services/backupContributor-agents'
import { ASSISTANTS_CONTRIBUTOR } from '@main/data/services/backupContributor-assistants'
import { FILE_STORAGE_CONTRIBUTOR } from '@main/data/services/backupContributor-file-storage'
import { KNOWLEDGE_CONTRIBUTOR } from '@main/data/services/backupContributor-knowledge'
import { MCP_SERVERS_CONTRIBUTOR } from '@main/data/services/backupContributor-mcp-servers'
import { MINIAPPS_CONTRIBUTOR } from '@main/data/services/backupContributor-miniapps'
import { PAINTINGS_CONTRIBUTOR } from '@main/data/services/backupContributor-paintings'
import { PROMPTS_CONTRIBUTOR } from '@main/data/services/backupContributor-prompts'
import { PROVIDERS_CONTRIBUTOR } from '@main/data/services/backupContributor-providers'
import { SKILLS_CONTRIBUTOR } from '@main/data/services/backupContributor-skills'
import { TAGS_GROUPS_CONTRIBUTOR } from '@main/data/services/backupContributor-tags-groups'
import { TOPICS_CONTRIBUTOR } from '@main/data/services/backupContributor-topics'
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
  AGENTS_CONTRIBUTOR,
  ASSISTANTS_CONTRIBUTOR,
  FILE_STORAGE_CONTRIBUTOR,
  KNOWLEDGE_CONTRIBUTOR,
  MCP_SERVERS_CONTRIBUTOR,
  MINIAPPS_CONTRIBUTOR,
  PAINTINGS_CONTRIBUTOR,
  PREFERENCES_CONTRIBUTOR,
  PROMPTS_CONTRIBUTOR,
  PROVIDERS_CONTRIBUTOR,
  SKILLS_CONTRIBUTOR,
  TAGS_GROUPS_CONTRIBUTOR,
  TOPICS_CONTRIBUTOR,
  TRANSLATE_HISTORY_CONTRIBUTOR
}

/**
 * The contributor barrel — every BackupContributor the backup system knows.
 *
 * Landed (14 of 14): PREFERENCES, PROVIDERS, PROMPTS, MCP_SERVERS, TAGS_GROUPS,
 * ASSISTANTS, SKILLS, TRANSLATE_HISTORY (Wave 1) + FILE_STORAGE, KNOWLEDGE,
 * PAINTINGS, MINIAPPS, TOPICS, AGENTS (Wave 2).
 *
 * Finalize invariant #1 requires registry.length === 14 — now satisfied.
 * ContributorManager's TODO(B) wires `new ContributorManager(CONTRIBUTORS)`.
 */
export const CONTRIBUTORS: readonly BackupContributor[] = [
  PREFERENCES_CONTRIBUTOR,
  PROVIDERS_CONTRIBUTOR,
  PROMPTS_CONTRIBUTOR,
  MCP_SERVERS_CONTRIBUTOR,
  TAGS_GROUPS_CONTRIBUTOR,
  ASSISTANTS_CONTRIBUTOR,
  AGENTS_CONTRIBUTOR,
  SKILLS_CONTRIBUTOR,
  TRANSLATE_HISTORY_CONTRIBUTOR,
  FILE_STORAGE_CONTRIBUTOR,
  KNOWLEDGE_CONTRIBUTOR,
  MINIAPPS_CONTRIBUTOR,
  PAINTINGS_CONTRIBUTOR,
  TOPICS_CONTRIBUTOR
]
