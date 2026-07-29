/**
 * Runs every resource adapter over one detached portable database and returns
 * the manifest's requirement inventory (docs/references/backup/README.md §2, §7).
 *
 * The database is opened READ-ONLY. Export calls this on the sealed artifact
 * whose SHA-256 is already recorded, so a single stray write would invalidate
 * the manifest's own hash; `readonly` makes that a SQLite error rather than a
 * corrupted archive. It is also why no `PRAGMA` is issued here — the artifact
 * arrives sealed (`journal_mode=DELETE`, no sidecars) and must stay that way.
 */

import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import type { ResourceRequirement } from '../manifest'
import { currentBackupPlatform } from '../platform'
import {
  BACKUP_RESOURCE_KINDS,
  type BackupResourceKind,
  RESOURCE_ADAPTERS,
  type ResourceRoots,
  type UnitContentRequirement
} from './adapters'

const logger = loggerService.withContext('backupResourceInventory')

export interface ResourceInventory {
  /** Deduplicated by `livePath`, ordered by adapter then by discovery. */
  readonly requirements: readonly ResourceRequirement[]
  /**
   * Per-kind count of database references that can never be a managed
   * requirement — external user paths and paths a portable archive cannot
   * express. Counts only; see {@link AdapterInventory} for why no path is kept.
   */
  readonly unverifiableByKind: Readonly<Record<BackupResourceKind, number>>
  /**
   * Keyed by `livePath`, for the units that must prove they carry their own
   * source material before the archive may ship them (§5.4). Derived from rows
   * alone, like everything else here — the proof itself belongs to staging.
   */
  readonly requiredContent: ReadonlyMap<string, UnitContentRequirement>
}

export interface CollectRequirementsInput {
  /** Absolute path to the detached portable database. */
  readonly dbPath: string
  /**
   * Managed roots to resolve paths against. Omitted on the export side, where
   * the running profile IS the producer; restore preview passes target roots.
   */
  readonly roots?: ResourceRoots
  readonly userDataPath?: string
}

/** Resolve the managed roots from the path registry — the one place that does. */
export function resolveResourceRoots(): ResourceRoots {
  return {
    files: application.getPath('feature.files.data'),
    knowledge: application.getPath('feature.knowledgebase.data'),
    notes: application.getPath('feature.notes.data'),
    agentData: application.getPath('feature.agents.data'),
    systemWorkspaces: application.getPath('feature.agents.system_workspaces'),
    skills: application.getPath('feature.agents.skills')
  }
}

export function collectResourceRequirements(input: CollectRequirementsInput): ResourceInventory {
  const sqlite = new Database(input.dbPath, { fileMustExist: true, readonly: true })
  try {
    return collectResourceRequirementsFrom(drizzle({ client: sqlite, casing: 'snake_case' }), input)
  } finally {
    sqlite.close()
  }
}

/**
 * The same inventory taken from an ALREADY-OPEN database. Post-promotion work
 * runs against the live connection rather than opening a second one — the
 * restored database is live by then, so there is nothing detached left to read.
 */
export function collectResourceRequirementsFrom(
  db: DbOrTx,
  options: Omit<CollectRequirementsInput, 'dbPath'> = {}
): ResourceInventory {
  {
    const ctx = {
      db,
      userDataPath: options.userDataPath ?? application.getPath('app.userdata'),
      roots: options.roots ?? resolveResourceRoots(),
      platform: currentBackupPlatform()
    }

    const requirements: ResourceRequirement[] = []
    const requiredContent = new Map<string, UnitContentRequirement>()
    const seen = new Set<string>()
    const unverifiableByKind = Object.fromEntries(BACKUP_RESOURCE_KINDS.map((kind) => [kind, 0])) as Record<
      BackupResourceKind,
      number
    >

    for (const adapter of RESOURCE_ADAPTERS) {
      const inventory = adapter.collectRequirements(ctx)
      unverifiableByKind[adapter.kind] = inventory.unverifiable
      for (const requirement of inventory.requirements) {
        // Two rows can legitimately name one path (a shared Notes root); the
        // inventory declares targets, so it carries each target once.
        if (seen.has(requirement.livePath)) continue
        seen.add(requirement.livePath)
        requirements.push(requirement)
        const content = inventory.requiredContent?.get(requirement.livePath)
        if (content !== undefined) requiredContent.set(requirement.livePath, content)
      }
    }

    const unverifiableTotal = Object.values(unverifiableByKind).reduce((sum, count) => sum + count, 0)
    if (unverifiableTotal > 0) {
      logger.info('Resource inventory has references outside every managed root', {
        unverifiableTotal,
        requirements: requirements.length
      })
    }

    return { requirements, unverifiableByKind, requiredContent }
  }
}
