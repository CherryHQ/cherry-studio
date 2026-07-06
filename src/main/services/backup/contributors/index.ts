// Backup contributors barrel — ContributorManager + finalize + the read-only
// registry view + the CONTRIBUTORS barrel that aggregates the domain contributor
// declarations.
//
// Per backup-architecture §7 / contributor-framework "placement", the domain
// contributor declarations live in their OWNING domain modules (not here); this
// module re-exports the per-domain constants + the aggregated CONTRIBUTORS barrel
// (defined in ./CONTRIBUTORS) + the framework (ContributorManager / finalize /
// ReadonlyBackupRegistry). The barrel is the single import surface for "all
// backup contributors".
//
// CONTRIBUTORS lives in its own module so ContributorManager can import it
// directly without a circular dependency back through this barrel.

export type { ContributorFinalizePayload } from './ContributorFinalizeError'
export { ContributorFinalizeError } from './ContributorFinalizeError'
export { ContributorManager, contributorManager } from './ContributorManager'
export {
  AGENTS_CONTRIBUTOR,
  ASSISTANTS_CONTRIBUTOR,
  CONTRIBUTORS,
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
} from './CONTRIBUTORS'
export { finalize } from './finalize'
export type { FinalizedRegistryData } from './ReadonlyBackupRegistryImpl'
export { CircularReferenceError, READONLY_REGISTRY, ReadonlyBackupRegistryImpl } from './ReadonlyBackupRegistryImpl'
