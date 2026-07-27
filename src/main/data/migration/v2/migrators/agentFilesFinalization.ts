import path from 'node:path'

import { appStateTable } from '@data/db/schemas/appState'
import type { DbType } from '@data/db/types'
import { eq } from 'drizzle-orm'

import { cleanupLegacyAgentFiles, type LegacyAgentFilesCleanupPlan } from './agentsFilesystemMigration'

const AGENT_FILES_FINALIZATION_KEY = 'migration_v2_agent_files_finalization'
const AGENT_FILES_FINALIZATION_VERSION = 1
const SHA256_FINGERPRINT = /^[a-f0-9]{64}$/

interface StoredAgentFilesFinalization {
  version: typeof AGENT_FILES_FINALIZATION_VERSION
  plan: LegacyAgentFilesCleanupPlan
}

function parseStoredFinalization(value: unknown): StoredAgentFilesFinalization {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid Agent files finalization state')
  }
  const stored = value as Partial<StoredAgentFilesFinalization>
  const plan = stored.plan as Partial<LegacyAgentFilesCleanupPlan> | undefined
  if (
    stored.version !== AGENT_FILES_FINALIZATION_VERSION ||
    !plan ||
    typeof plan.agentsDataRoot !== 'string' ||
    !Array.isArray(plan.workspaces) ||
    plan.workspaces.some(
      (workspace) =>
        !workspace ||
        typeof workspace.workspacePath !== 'string' ||
        !Array.isArray(workspace.entries) ||
        workspace.entries.some(
          (entry) =>
            !entry ||
            typeof entry.entryName !== 'string' ||
            typeof entry.sourceFingerprint !== 'string' ||
            !SHA256_FINGERPRINT.test(entry.sourceFingerprint) ||
            typeof entry.sourceMetadataFingerprint !== 'string' ||
            !SHA256_FINGERPRINT.test(entry.sourceMetadataFingerprint) ||
            typeof entry.destinationPath !== 'string' ||
            !path.isAbsolute(entry.destinationPath) ||
            typeof entry.destinationFingerprint !== 'string' ||
            !SHA256_FINGERPRINT.test(entry.destinationFingerprint) ||
            typeof entry.destinationMetadataFingerprint !== 'string' ||
            !SHA256_FINGERPRINT.test(entry.destinationMetadataFingerprint)
        )
    )
  ) {
    throw new Error('Invalid Agent files finalization state')
  }
  return stored as StoredAgentFilesFinalization
}

export function replacePendingAgentFilesFinalization(db: DbType, plan: LegacyAgentFilesCleanupPlan): void {
  if (plan.workspaces.length === 0) {
    discardPendingAgentFilesFinalization(db)
    return
  }

  const value: StoredAgentFilesFinalization = {
    version: AGENT_FILES_FINALIZATION_VERSION,
    plan
  }
  db.insert(appStateTable)
    .values({
      key: AGENT_FILES_FINALIZATION_KEY,
      value,
      description: 'Pending copy-verified cleanup of migrated v1 Agent files'
    })
    .onConflictDoUpdate({
      target: appStateTable.key,
      set: {
        value,
        updatedAt: Date.now()
      }
    })
    .run()
}

export function discardPendingAgentFilesFinalization(db: DbType): void {
  db.delete(appStateTable).where(eq(appStateTable.key, AGENT_FILES_FINALIZATION_KEY)).run()
}

export async function finalizePendingAgentFiles(db: DbType, expectedAgentsDataRoot: string): Promise<boolean> {
  const row = db
    .select({ value: appStateTable.value })
    .from(appStateTable)
    .where(eq(appStateTable.key, AGENT_FILES_FINALIZATION_KEY))
    .get()
  if (!row) return false

  const { plan } = parseStoredFinalization(row.value)
  if (path.resolve(plan.agentsDataRoot) !== path.resolve(expectedAgentsDataRoot)) {
    throw new Error('Agent files finalization root does not match the active migration data root')
  }

  await cleanupLegacyAgentFiles(plan)
  discardPendingAgentFilesFinalization(db)
  return true
}
