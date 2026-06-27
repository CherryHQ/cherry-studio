// Backup contributors barrel (Track A3) — ContributorManager + finalize + the
// read-only registry view. The 14 domain contributor declarations + the
// CONTRIBUTORS barrel arrive in the B track; until then ContributorManager is
// constructed with an empty array (getRegistry fails fast at invariant #1).

export type { ContributorFinalizePayload } from './ContributorFinalizeError'
export { ContributorFinalizeError } from './ContributorFinalizeError'
export { ContributorManager, contributorManager } from './ContributorManager'
export { finalize } from './finalize'
export type { FinalizedRegistryData } from './ReadonlyBackupRegistryImpl'
export { CircularReferenceError, READONLY_REGISTRY, ReadonlyBackupRegistryImpl } from './ReadonlyBackupRegistryImpl'
