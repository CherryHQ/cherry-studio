// ContributorManager — non-lifecycle named singleton (registry.md §"ContributorManager
// non-lifecycle singleton + 惰性 finalize").
//
// Deliberately NOT a BaseService: it owns no long-lived resource, holds no DB
// connection, registers no IPC/timer/event side effects — it only performs a
// one-shot in-memory finalize producing a frozen registry. That matches the
// CLAUDE.md "Non-Lifecycle Services" decision guide, so it is NOT in
// serviceRegistry.ts and uses no @Injectable/@ServicePhase decorators.
//
// Lazy trigger: BackupService (a WhenReady lifecycle service) calls
// getRegistry() in onInit(); the first call runs finalize synchronously and
// caches the frozen result. A finalize failure throws ContributorFinalizeError,
// which surfaces as a BackupService.onInit failure → the lifecycle container
// refuses to start, preserving the startup-time validation semantics.

import type { BackupContributor, ReadonlyBackupRegistry } from '@main/data/db/backup/contributorTypes'
import { BACKUP_REFS_META } from '@main/data/db/backup/dbSchemaRefs'

import { CONTRIBUTORS } from './CONTRIBUTORS'
import { finalize } from './finalize'

/**
 * Non-lifecycle singleton managing the one-shot finalize of the contributor
 * registry. Construction is cheap; the expensive 26-invariant validation runs
 * lazily on the first getRegistry() call and is then cached.
 *
 * Contributors are injected via the constructor. The process-wide
 * `contributorManager` singleton (below) wires the real 14 via the CONTRIBUTORS
 * barrel. Tests inject synthetic contributors to exercise finalize in isolation.
 */
export class ContributorManager {
  private cachedRegistry: ReadonlyBackupRegistry | undefined

  constructor(private readonly contributors: readonly BackupContributor[] = []) {}

  /**
   * Lazily finalize + cache the registry. Idempotent: only the first call runs
   * finalize; subsequent calls return the same frozen instance.
   * @throws ContributorFinalizeError on the first call if an invariant is violated.
   */
  getRegistry(): ReadonlyBackupRegistry {
    if (this.cachedRegistry) return this.cachedRegistry
    this.cachedRegistry = this.finalize()
    return this.cachedRegistry
  }

  /** Run the 26-invariant finalize against the wired contributors (pure, in-memory). */
  private finalize(): ReadonlyBackupRegistry {
    return finalize(this.contributors, {
      // Stamp the real finalize instant and the codegen schema commit the
      // invariants were checked against — both surface on the registry for diagnostics.
      finalizedAt: new Date().toISOString(),
      schemaCommit: BACKUP_REFS_META.schemaCommit
    })
  }
}

/**
 * The process-wide singleton, wired with the real 14-domain CONTRIBUTORS barrel.
 * BackupService.onInit() calls getRegistry() to lazily run finalize + cache the
 * frozen registry; a finalize failure surfaces as a BackupService.onInit failure
 * → the lifecycle container refuses to start.
 */
export const contributorManager = new ContributorManager(CONTRIBUTORS)
