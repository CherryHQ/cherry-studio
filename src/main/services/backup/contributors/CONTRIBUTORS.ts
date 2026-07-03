// The CONTRIBUTORS barrel + per-domain contributor re-exports.
//
// Split into its own module (rather than living in index.ts) so ContributorManager
// can import CONTRIBUTORS without a circular dependency: index.ts re-exports
// ContributorManager, so a ContributorManager → index → ContributorManager cycle
// would leave CONTRIBUTORS uninitialised at module-eval time. ContributorManager
// imports this module directly instead.
//
// Landed (14 of 14): PREFERENCES, PROVIDERS, PROMPTS, MCP_SERVERS, TAGS_GROUPS,
// ASSISTANTS, SKILLS, TRANSLATE_HISTORY (Wave 1) + FILE_STORAGE, KNOWLEDGE,
// PAINTINGS, MINIAPPS, TOPICS, AGENTS (Wave 2). Finalize invariant #1
// (registry.length === 14) is satisfied.

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
 * ContributorManager wires this into its singleton; the coverage test reads it too.
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
