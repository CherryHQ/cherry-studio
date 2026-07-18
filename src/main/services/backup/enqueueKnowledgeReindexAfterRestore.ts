// After restore promotion + relaunch: explicitly enqueue KB vector rebuilds.
//
// Full export excludes `.cherry/index.sqlite{,-wal,-shm}` (FileStager R1). An empty
// / missing index does NOT auto-rebuild (createIndexStore creates a blank schema;
// KnowledgeVectorStoreService only logs when completed items meet an empty store).
// So the live side must enqueue `knowledge.index-documents` (via reindex-subtree,
// which resets completed → processing then scheduleIndexing) for restored bases.

import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { RestoreJournal } from '@main/data/db/restore/restoreJournal'
import {
  getKnowledgeVectorStoreFilePathSync,
  isContainerKnowledgeItem,
  isIndexableKnowledgeItem,
  type KnowledgeIndexDocumentsPayload
} from '@main/features/knowledge'

const logger = loggerService.withContext('backup/enqueueKnowledgeReindexAfterRestore')

/**
 * Build the `knowledge.index-documents` job payload (`jobTypes.ts`). Used by
 * tests and by callers that enqueue leaves directly with `parentJobId: null`.
 */
export function knowledgeIndexDocumentsPayload(
  baseId: string,
  itemId: string,
  parentJobId: string | null = null
): KnowledgeIndexDocumentsPayload {
  return { baseId, itemId, parentJobId }
}

/**
 * Collect knowledge base ids from a restore journal's `dir-add` entries whose
 * `livePath` sits directly under the knowledge root (userData-relative).
 *
 * @param knowledgeRootRelativeToUserData e.g. `Data/KnowledgeBase` — no trailing slash
 */
export function collectRestoredKnowledgeBaseIds(
  fileResources: RestoreJournal['fileResources'],
  knowledgeRootRelativeToUserData: string
): string[] {
  const prefix = knowledgeRootRelativeToUserData.replace(/[/\\]+$/, '') + '/'
  const ids: string[] = []
  for (const entry of fileResources) {
    if (entry.kind !== 'dir-add') continue
    const live = entry.livePath.replace(/\\/g, '/')
    if (!live.startsWith(prefix)) continue
    const rest = live.slice(prefix.length)
    // Only direct children of the knowledge root are base dirs.
    if (!rest || rest.includes('/')) continue
    ids.push(rest)
  }
  return ids
}

/**
 * Whether a restored base still needs an explicit reindex (index file absent).
 * Once `getIndexStore` / reindex creates `index.sqlite`, a later boot must not
 * blindly re-enqueue solely because a completed journal is still on disk.
 */
export function restoredKnowledgeBaseNeedsReindex(baseId: string): boolean {
  return !existsSync(getKnowledgeVectorStoreFilePathSync(baseId))
}

/**
 * Outermost completed roots (leaves + directory containers) that should be
 * reindexed after a restore that omitted the derived index.
 */
export function listCompletedRootsForRestoreReindex(baseId: string): string[] {
  const items = knowledgeItemService.getItemsByBaseId(baseId)
  const completedIds = items
    .filter((item) => item.status === 'completed' && (isIndexableKnowledgeItem(item) || isContainerKnowledgeItem(item)))
    .map((item) => item.id)
  if (completedIds.length === 0) return []
  return knowledgeItemService.getOutermostSelectedItemIds(baseId, completedIds)
}

export type EnqueueKnowledgeReindexAfterRestoreDeps = {
  /** Enqueue `knowledge.reindex-subtree` for the given roots (resets + scheduleIndexing). */
  reindexItems: (baseId: string, rootItemIds: string[]) => Promise<void>
  listCompletedRoots?: (baseId: string) => string[]
  needsReindex?: (baseId: string) => boolean
}

/**
 * For each restored base whose `index.sqlite` is still absent, enqueue
 * `knowledge.reindex-subtree` over completed roots. That job resets status and
 * then enqueues `knowledge.index-documents` with payload
 * `{ baseId, itemId, parentJobId }` matching `jobTypes.ts`.
 */
export async function enqueueKnowledgeReindexAfterRestore(
  baseIds: readonly string[],
  deps: EnqueueKnowledgeReindexAfterRestoreDeps
): Promise<void> {
  const listRoots = deps.listCompletedRoots ?? listCompletedRootsForRestoreReindex
  const needsReindex = deps.needsReindex ?? restoredKnowledgeBaseNeedsReindex

  for (const baseId of baseIds) {
    if (!needsReindex(baseId)) {
      logger.info('Skipping restore reindex — index.sqlite already present', { baseId })
      continue
    }
    const rootItemIds = listRoots(baseId)
    if (rootItemIds.length === 0) {
      logger.info('Skipping restore reindex — no completed roots', { baseId })
      continue
    }
    logger.info('Enqueueing knowledge reindex after restore', { baseId, rootCount: rootItemIds.length })
    await deps.reindexItems(baseId, rootItemIds)
  }
}

/**
 * Resolve the userData-relative knowledge root from an absolute path + userData.
 * Keeps journal livePath matching independent of path-registry internals in tests.
 */
export function knowledgeRootRelativeToUserData(userData: string, knowledgeRootAbs: string): string {
  const normalizedUser = userData.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedRoot = knowledgeRootAbs.replace(/\\/g, '/')
  if (normalizedRoot === normalizedUser) return ''
  if (normalizedRoot.startsWith(normalizedUser + '/')) {
    return normalizedRoot.slice(normalizedUser.length + 1)
  }
  // Fallback: last path segment (production: `Data/KnowledgeBase` → still wrong if
  // userData layout differs; callers should pass abs paths from application.getPath).
  return join(basename(dirname(normalizedRoot)), basename(normalizedRoot)).replace(/\\/g, '/')
}
