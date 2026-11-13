import '../tasks/jobTypes'
import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { FileProcessingTaskId } from '@main/features/fileProcessing'
import { getFileExt } from '@main/utils/legacyFile'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { ACTIVE_JOB_STATUSES } from '@shared/data/api/schemas/jobs'
import type { UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import { FileProcessorIdSchema } from '@shared/data/presets/fileProcessing'
import {
  type CreateKnowledgeItemDto,
  DEFAULT_KNOWLEDGE_ADD_CONFLICT_STRATEGY,
  KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED,
  type KnowledgeAddConflictStrategy,
  type KnowledgeAddItemInput,
  type KnowledgeAddItemsResult,
  type KnowledgeBase,
  type KnowledgeItem,
  type KnowledgeItemStatus
} from '@shared/data/types/knowledge'
import type { KeyedMutex } from '@shared/utils/async'
import { knowledgeSupportedFileExts } from '@shared/utils/file'

import { assertBaseCanRunRuntimeOperation } from '../base/baseGuards'
import { classifyKnowledgeItemReacquireSource } from '../items'
import {
  assertKnowledgeFileTargetAvailable,
  collectKnowledgeReservedRelativePaths,
  copyFileIntoKnowledgeBaseAt,
  deleteKnowledgeItemFilesBestEffort,
  getKnowledgeBaseFilePath,
  getKnowledgeSourceRelativePath,
  getProcessedMarkdownRelativePath,
  needsProcessedArtifactReservation,
  reserveImportedFileRelativePath
} from '../pathStorage'
import { type KnowledgeSourcePlanOptions, planKnowledgeItemSource } from '../pipeline/sources/sourcePlanning'
import type { KnowledgeSourceCopy } from '../tasks/jobTypes'
import { cancelActiveKnowledgeJobs } from '../tasks/utils/cancel'
import {
  type KnowledgeBaseId,
  knowledgeCopySourcesIdempotencyKey,
  knowledgeDeleteSubtreeIdempotencyKey,
  knowledgeFileProcessingCheckIdempotencyKey,
  knowledgeIndexIdempotencyKey,
  type KnowledgeItemId,
  knowledgePrepareIdempotencyKey,
  knowledgeQueueName,
  knowledgeReindexSubtreeIdempotencyKey,
  toKnowledgeBaseId,
  toKnowledgeItemId,
  toKnowledgeItemIds
} from '../types'
import { resolveKnowledgeAddConflicts } from './addConflicts'
import type { FileProcessingWaitManager } from './FileProcessingWaitManager'
import { markUnscheduledKnowledgeItemsFailed } from './statusCleanup'
import { purgeKnowledgeSubtreeWithinLock } from './subtreePurge'

const logger = loggerService.withContext('Knowledge:IngestionService')
const KNOWLEDGE_SUPPORTED_FILE_EXT_SET = new Set<string>(knowledgeSupportedFileExts)
const REINDEX_ALLOWED_STATUSES = new Set<KnowledgeItemStatus>(['completed', 'failed'])
const DELETE_RECOVERY_ROOT_CHUNK_SIZE = 500

/**
 * The workflow re-entry seam job handlers call back into (workflow-architecture.md): expand a
 * container or index a leaf. Handlers depend on exactly this surface, not the full
 * `KnowledgeIngestionService`.
 */
export interface KnowledgeItemScheduler {
  scheduleItem(
    baseId: KnowledgeBaseId,
    itemId: KnowledgeItemId,
    parentJobId?: string | null,
    options?: KnowledgeSourcePlanOptions
  ): Promise<void>
  scheduleIndexing(baseId: KnowledgeBaseId, itemId: KnowledgeItemId, parentJobId?: string | null): Promise<void>
}

/** Write-side orchestration: admission checks, item creation, conflict handling, and job enqueueing for the add/delete/reindex flows. */
export class KnowledgeIngestionService implements KnowledgeItemScheduler {
  constructor(
    private readonly knowledgeLockManager: KeyedMutex,
    private readonly fileProcessingWaits: FileProcessingWaitManager
  ) {}

  /**
   * Accept a batch: resolve conflicts, reserve `raw/` names, and create the rows under the base
   * lock, then resolve. Source bytes are copied afterwards by one `knowledge.copy-sources` job per
   * item, off the lock.
   *
   * @param options.copyInline - Copy the bytes inside this call instead, so a failure rolls back
   *   the whole batch. Restore uses it: its target base is brand new, so holding the lock blocks
   *   nothing, and restore relies on all-or-nothing.
   */
  async addItems(
    baseId: string,
    inputs: KnowledgeAddItemInput[],
    conflictStrategy: KnowledgeAddConflictStrategy = DEFAULT_KNOWLEDGE_ADD_CONFLICT_STRATEGY,
    options: { copyInline?: boolean } = {}
  ): Promise<KnowledgeAddItemsResult> {
    const base = assertBaseCanRunRuntimeOperation(baseId, 'addItems')

    if (inputs.length === 0) {
      return { status: 'added' }
    }

    // rename (the default, and every internal caller — restore/migrator): keep all,
    // auto-rename on collision. detect/replace first resolve same-name conflicts
    // against the existing root items and earlier items in the same batch.
    let itemsToAdd = inputs
    if (conflictStrategy !== 'rename') {
      const existingRoots = knowledgeItemService.getRootItemsByBaseId(base.id)
      const resolution = resolveKnowledgeAddConflicts(inputs, existingRoots)
      if (conflictStrategy === 'detect') {
        if (resolution.conflicts.length > 0) {
          // Report and add nothing — the UI asks the user how to resolve.
          return { status: 'conflicts', conflicts: resolution.conflicts }
        }
      } else {
        // replace: incoming sources win. Drop earlier same-name batch items (last
        // wins) and cancel any in-flight job on the conflicting existing subtrees
        // BEFORE taking the lock — cancel awaits handler settlement and the
        // index/prepare handlers take this same base lock, so cancelling while
        // holding it would deadlock.
        itemsToAdd = resolution.keptInputs
        if (resolution.conflictingExistingRootIds.length > 0) {
          await cancelActiveKnowledgeJobs(base.id, 'knowledge-add-replace', {
            rootItemIds: resolution.conflictingExistingRootIds,
            onCancelTimeout: 'throw',
            fileProcessingWaits: this.fileProcessingWaits
          })
        }
      }
    }

    const acceptedItems: Array<{ item: KnowledgeItem; pendingCopies: KnowledgeSourceCopy[] }> = []
    const copiedFileItems: Array<Pick<CreateKnowledgeItemDto, 'type' | 'data'>> = []

    await this.knowledgeLockManager.runExclusive(base.id, async () => {
      try {
        if (conflictStrategy === 'replace') {
          // Purge the conflicting existing items synchronously inside the lock and
          // BEFORE reserving paths, so the freed name is claimed by the incoming
          // source instead of being auto-renamed with a numeric suffix.
          await this.purgeConflictingExistingItems(base, itemsToAdd)
        }

        // Reserve every existing on-disk path up front, then let each new file
        // claim a collision-free name (auto-renaming with a numeric suffix)
        // against the same growing set, so a same-named batch add no longer
        // throws — earlier inputs are visible when deduping later ones.
        const reservedPaths = this.loadReservedKnowledgeFilePaths(base.id, base.fileProcessorId)
        for (const input of itemsToAdd) {
          const { createInput, copies } = this.planRuntimeAddItemInput(base.fileProcessorId, input, reservedPaths)
          if (options.copyInline) {
            for (const copy of copies) {
              await copyFileIntoKnowledgeBaseAt(base.id, copy.from, copy.relativePath)
            }
            // A url restore copies its snapshot to raw/{relativePath} under type 'url',
            // so track it for rollback too — otherwise a mid-batch failure orphans the
            // snapshot and a same-titled re-restore later hard-fails on the leftover file
            // (the add-side twin of the delete-side leak fixed in deleteKnowledgeItemFiles).
            if (copies.length > 0) {
              copiedFileItems.push(createInput)
            }
          }
          const pendingCopies = options.copyInline ? [] : copies
          // Only files wait in `preparing`; a url only owes a copy when restored with a snapshot,
          // which restore copies inline.
          const createdItem = knowledgeItemService.createActive(base.id, createInput, {
            awaitingCopy: createInput.type === 'file' && pendingCopies.length > 0
          })
          acceptedItems.push({ item: createdItem, pendingCopies })
        }
      } catch (error) {
        this.rollbackAcceptedItems(
          base.id,
          acceptedItems.map(({ item }) => item),
          error
        )
        // Best-effort cleanup so a failed delete (EACCES/EBUSY/...) cannot
        // mask the original error that triggered the rollback.
        await deleteKnowledgeItemFilesBestEffort(base.id, copiedFileItems, {
          baseId: base.id,
          addError: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    })

    const completedSchedulingItemIds = new Set<string>()
    try {
      for (const { item, pendingCopies } of acceptedItems) {
        if (pendingCopies.length > 0) {
          this.scheduleSourceCopy(toKnowledgeBaseId(item.baseId), toKnowledgeItemId(item.id), pendingCopies)
        } else {
          await this.scheduleItem(toKnowledgeBaseId(item.baseId), toKnowledgeItemId(item.id))
        }
        completedSchedulingItemIds.add(item.id)
      }
    } catch (error) {
      this.markUnscheduledAcceptedItemsFailed(
        base.id,
        acceptedItems.map(({ item }) => item),
        completedSchedulingItemIds,
        error
      )
      throw error
    }

    return { status: 'added' }
  }

  /** Enqueue the off-lock byte copy for an accepted item; the copy job schedules its next stage. */
  private scheduleSourceCopy(baseId: KnowledgeBaseId, itemId: KnowledgeItemId, copies: KnowledgeSourceCopy[]): void {
    application.get('JobManager').enqueue(
      'knowledge.copy-sources',
      { baseId, itemId, copies },
      {
        idempotencyKey: knowledgeCopySourcesIdempotencyKey(baseId, itemId),
        queue: knowledgeQueueName(baseId)
      }
    )
  }

  /**
   * Remove the existing root items (and their subtrees) whose name an incoming
   * source collides with, for the `replace` strategy. MUST run inside the base
   * mutation lock. Re-resolves conflicts against the current roots so a change in
   * the cancel->lock gap is honored; the in-flight jobs were already cancelled by
   * the caller outside the lock.
   */
  private async purgeConflictingExistingItems(base: KnowledgeBase, itemsToAdd: KnowledgeAddItemInput[]): Promise<void> {
    const currentRoots = knowledgeItemService.getRootItemsByBaseId(base.id)
    const { conflictingExistingRootIds } = resolveKnowledgeAddConflicts(itemsToAdd, currentRoots)
    if (conflictingExistingRootIds.length === 0) {
      return
    }
    const subtreeItems = knowledgeItemService.getSubtreeItems(base.id, conflictingExistingRootIds, {
      includeRoots: true
    })
    await purgeKnowledgeSubtreeWithinLock(base, subtreeItems, { baseId: base.id, reason: 'knowledge-add-replace' })
  }

  async deleteItems(baseId: string, itemIds: string[]): Promise<void> {
    const rootItemIds = knowledgeItemService.getOutermostSelectedItemIds(baseId, itemIds)
    if (rootItemIds.length === 0) {
      return
    }

    knowledgeBaseService.getById(baseId)
    const knowledgeBaseId = toKnowledgeBaseId(baseId)
    const knowledgeRootItemIds = toKnowledgeItemIds(rootItemIds)
    await this.knowledgeLockManager.runExclusive(baseId, () =>
      application.get('DbService').withWriteTx((tx) => {
        knowledgeItemService.setSubtreeStatusTx(tx, baseId, rootItemIds, 'deleting')
        application.get('JobManager').enqueueTx(
          tx,
          'knowledge.delete-subtree',
          { baseId, rootItemIds },
          {
            idempotencyKey: knowledgeDeleteSubtreeIdempotencyKey(knowledgeBaseId, knowledgeRootItemIds),
            queue: knowledgeQueueName(knowledgeBaseId)
          }
        )
      })
    )
  }

  async reindexItems(baseId: string, itemIds: string[]): Promise<void> {
    assertBaseCanRunRuntimeOperation(baseId, 'reindexItems')
    const rootItemIds = knowledgeItemService.getOutermostSelectedItemIds(baseId, itemIds)
    if (rootItemIds.length === 0) {
      return
    }

    await this.assertSubtreesCanReindex(baseId, rootItemIds)

    knowledgeBaseService.getById(baseId)
    const knowledgeBaseId = toKnowledgeBaseId(baseId)
    const jobManager = application.get('JobManager')
    // Re-check statuses under the base lock: a backfill may have activated these items during the
    // source check, and it looks for this reindex's jobs under the same lock.
    await this.knowledgeLockManager.runExclusive(baseId, () => {
      this.assertSubtreesSettled(knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true }))
      // One job per root: a delete or replace cancels every job touching its subtree, so roots
      // sharing a job would all be interrupted with it.
      for (const rootItemId of toKnowledgeItemIds(rootItemIds)) {
        jobManager.enqueue(
          'knowledge.reindex-subtree',
          { baseId, rootItemIds: [rootItemId] },
          {
            idempotencyKey: knowledgeReindexSubtreeIdempotencyKey(knowledgeBaseId, [rootItemId]),
            queue: knowledgeQueueName(knowledgeBaseId)
          }
        )
      }
    })
  }

  /**
   * Configures an embedding model on a base that has never had one (BM25-only), then
   * backfills embeddings for its existing items in place — no restore-into-a-new-base
   * needed, since a BM25-only base has no vectors to invalidate. `knowledgeBaseService.
   * update` still rejects switching an already-configured model this way; that case
   * keeps going through `restoreBase` because it does invalidate existing vectors.
   *
   * The model and every `completed` leaf's move back to `processing` commit in one transaction, so
   * no leaf reads as `completed` without vectors, even after a quit. Each leaf is then indexed by
   * its own regular job from the base's own copy; nothing is re-acquired from the originals.
   * `failed` leaves are left alone: they are not searchable, and any later reindex embeds them.
   */
  async enableEmbeddingModel(baseId: string, patch: UpdateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const { updatedBase, leafItemIds } = await this.knowledgeLockManager.runExclusive(baseId, async () => {
      // Read statuses under the lock: an add that ran while this call waited for it may have
      // started an item against the BM25-only configuration.
      const rootItems = knowledgeItemService.getRootItemsByBaseId(baseId).filter((item) => item.status !== 'deleting')
      const rootItemIds = rootItems.map((item) => item.id)
      if (rootItemIds.length > 0) {
        assertBaseCanRunRuntimeOperation(baseId, 'enableEmbeddingModel')
        this.assertSubtreesSettled(knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true }))
      }
      await this.assertNoReindexPending(baseId)
      return application.get('DbService').withWriteTx((tx) => ({
        updatedBase: knowledgeBaseService.updateTx(tx, baseId, patch, { allowEmbeddingModelBackfill: true }),
        leafItemIds: knowledgeItemService.activateCompletedLeavesTx(tx, baseId)
      }))
    })

    await this.scheduleBackfillLeaves(baseId, leafItemIds)
    return updatedBase
  }

  /**
   * A queued or still-copying reindex leaves its items `completed`, so only its job shows it is
   * pending; a backfill admitted next to it would index the old copy over the refreshed one.
   */
  private async assertNoReindexPending(baseId: string): Promise<void> {
    const [reindexJob] = await application.get('JobManager').list({
      queue: knowledgeQueueName(toKnowledgeBaseId(baseId)),
      type: 'knowledge.reindex-subtree',
      status: [...ACTIVE_JOB_STATUSES],
      limit: 1
    })
    if (reindexJob) {
      throw DataApiErrorFactory.validation(
        { base: [`Knowledge base '${baseId}' has a reindex in progress`] },
        'Cannot enable an embedding model until the reindex finishes'
      )
    }
  }

  /** Give each activated leaf its own indexing job; a leaf that cannot be scheduled fails on its own. */
  private async scheduleBackfillLeaves(baseId: string, leafItemIds: string[]): Promise<void> {
    for (const itemId of leafItemIds) {
      try {
        await this.scheduleItem(toKnowledgeBaseId(baseId), toKnowledgeItemId(itemId))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(
          'Failed to schedule embedding backfill for knowledge item',
          error instanceof Error ? error : new Error(message),
          {
            baseId,
            itemId
          }
        )
        knowledgeItemService.setSubtreeStatus(baseId, [itemId], 'failed', {
          error: `Failed to schedule knowledge item job: ${message}`
        })
      }
    }
  }

  async scheduleItem(
    baseId: KnowledgeBaseId,
    itemId: KnowledgeItemId,
    parentJobId: string | null = null,
    options: KnowledgeSourcePlanOptions = {}
  ): Promise<void> {
    const base = knowledgeBaseService.getById(baseId)
    const item = knowledgeItemService.getById(itemId)
    if (item.baseId !== baseId) {
      throw new Error(`Knowledge item '${itemId}' does not belong to base '${baseId}'`)
    }
    if (item.status === 'deleting') {
      return
    }

    const plan = planKnowledgeItemSource(base, item, options)
    if (plan.kind === 'invalid') {
      knowledgeItemService.updateStatus(itemId, 'failed', { error: plan.reason })
      return
    }

    // A reindex just replaced this file's bytes. When the plan is not going to regenerate its
    // processed artifact — the base's processor was removed, or the item arrived from a restore
    // already carrying one — that artifact describes content the file no longer has, and indexing
    // it would quietly rebuild search from the pre-refresh document. Unpin it (and reclaim its
    // bytes, now that nothing reserves the path) so the index reads the refreshed file instead.
    if (options.forceFileReprocess && plan.kind === 'index-documents' && item.type === 'file') {
      const staleRelativePath = item.data.indexedRelativePath
      if (staleRelativePath) {
        knowledgeItemService.clearIndexedRelativePath(itemId)
        await deleteKnowledgeItemFilesBestEffort(
          baseId,
          [{ type: 'file', data: { relativePath: staleRelativePath } }],
          {
            baseId,
            itemId,
            staleRelativePath
          }
        )
      }
    }

    const jobManager = application.get('JobManager')
    if (plan.kind === 'prepare-root') {
      jobManager.enqueue(
        'knowledge.prepare-root',
        { baseId, itemId },
        {
          idempotencyKey: knowledgePrepareIdempotencyKey(baseId, itemId),
          queue: knowledgeQueueName(baseId),
          parentId: parentJobId ?? undefined
        }
      )
      return
    }

    if (plan.kind === 'needsFileProcessing') {
      if (item.type !== 'file') {
        throw new Error(`File processing source plan produced for non-file item: ${item.id}`)
      }
      const processorId = FileProcessorIdSchema.parse(base.fileProcessorId)
      const fileProcessing = application.get('FileProcessingService')
      const sourcePath = getKnowledgeBaseFilePath(baseId, item.data.relativePath)
      const processedRelativePath = getProcessedMarkdownRelativePath(item.data.relativePath)
      if (item.data.indexedRelativePath !== processedRelativePath) {
        this.assertKnowledgeRelativePathNotReserved(baseId, base.fileProcessorId, item.id, processedRelativePath)
        await assertKnowledgeFileTargetAvailable(baseId, processedRelativePath)
      }
      const processedPath = getKnowledgeBaseFilePath(baseId, processedRelativePath)
      const { task, done } = await fileProcessing.startTask({
        feature: 'document_to_markdown',
        file: { kind: 'path', path: sourcePath },
        output: { kind: 'path', path: processedPath },
        context: { dataId: item.id },
        processorId
      })
      this.fileProcessingWaits.add(baseId, itemId, task.id)
      done
        .then(() => {
          this.fileProcessingWaits.delete(itemId)
          this.scheduleFileProcessingCheck(baseId, itemId, task.id, { parentJobId, processedRelativePath })
        })
        .catch((error: unknown) => {
          logger.error('Failed to schedule the file-processing result check', error as Error, {
            baseId,
            itemId,
            fileProcessingTaskId: task.id
          })
        })
      return
    }

    await this.scheduleIndexing(baseId, itemId, parentJobId)
  }

  /** Enqueue the job that reads a settled file-processing task's result and hands the item on. */
  private scheduleFileProcessingCheck(
    baseId: KnowledgeBaseId,
    itemId: KnowledgeItemId,
    fileProcessingTaskId: FileProcessingTaskId,
    options: { parentJobId: string | null; processedRelativePath: string }
  ): void {
    const { parentJobId, processedRelativePath } = options
    application.get('JobManager').enqueue(
      'knowledge.check-file-processing-result',
      { baseId, itemId, fileProcessingTaskId, processedRelativePath },
      {
        idempotencyKey: knowledgeFileProcessingCheckIdempotencyKey(baseId, itemId, fileProcessingTaskId),
        queue: knowledgeQueueName(baseId),
        parentId: parentJobId ?? undefined
      }
    )
  }

  /**
   * Enqueue the index-documents job for an item. The single point that builds
   * this job's idempotency key, queue, and parent id — shared by `scheduleItem`
   * and the file-processing check handler so the enqueue stays identical.
   */
  async scheduleIndexing(
    baseId: KnowledgeBaseId,
    itemId: KnowledgeItemId,
    parentJobId: string | null = null
  ): Promise<void> {
    const jobManager = application.get('JobManager')
    jobManager.enqueue(
      'knowledge.index-documents',
      { baseId, itemId },
      {
        idempotencyKey: knowledgeIndexIdempotencyKey(baseId, itemId, parentJobId),
        queue: knowledgeQueueName(baseId),
        parentId: parentJobId ?? undefined
      }
    )
  }

  /**
   * Park items stranded mid-indexing by an app quit / restart at `failed`.
   *
   * Indexing handlers declare `recovery: 'abandon'`, so an interrupted job is
   * cancelled rather than silently resumed on the next launch — a deliberate
   * quit must not auto-spend the (paid) embedding API. The job side is handled
   * by JobManager's startup recovery; this closes the item side. The common case
   * (handler settled the abort as cancelled) is already flipped to `failed` by
   * the job's onSettled; this is the boot-time safety net for the stragglers
   * onSettled lost the race to write (process exited first) or never ran (hard
   * kill / crash). Marking them `failed` clears the perpetual spinner and makes
   * them reindexable so the user can finish them on demand.
   */
  recoverInterruptedItems(): void {
    try {
      const failedCount = knowledgeItemService.failInterruptedItems(KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED)
      if (failedCount > 0) {
        logger.info('Recovered interrupted knowledge items', { count: failedCount })
      }
    } catch (error) {
      logger.error('Failed to recover interrupted knowledge items', error as Error)
    }
  }

  recoverDeletingItems(): void {
    let deletingRootGroups: Awaited<ReturnType<typeof knowledgeItemService.getDeletingRootGroups>>
    try {
      deletingRootGroups = knowledgeItemService.getDeletingRootGroups()
    } catch (error) {
      logger.error('Failed to scan deleting knowledge items for recovery', error as Error)
      return
    }

    if (deletingRootGroups.length === 0) {
      return
    }

    const jobManager = application.get('JobManager')
    for (const { baseId, rootItemIds } of deletingRootGroups) {
      for (let i = 0; i < rootItemIds.length; i += DELETE_RECOVERY_ROOT_CHUNK_SIZE) {
        const rootItemIdChunk = rootItemIds.slice(i, i + DELETE_RECOVERY_ROOT_CHUNK_SIZE)
        try {
          jobManager.enqueue(
            'knowledge.delete-subtree',
            { baseId, rootItemIds: rootItemIdChunk },
            {
              idempotencyKey: knowledgeDeleteSubtreeIdempotencyKey(
                toKnowledgeBaseId(baseId),
                toKnowledgeItemIds(rootItemIdChunk)
              ),
              queue: knowledgeQueueName(toKnowledgeBaseId(baseId))
            }
          )
        } catch (error) {
          logger.error('Failed to enqueue recovered knowledge delete cleanup', error as Error, {
            baseId,
            rootItemIds: rootItemIdChunk
          })
        }
      }
    }
  }

  private async assertSubtreesCanReindex(baseId: string, rootItemIds: string[]): Promise<void> {
    // rootItemIds comes from getOutermostSelectedItemIds, which guarantees the roots are mutually
    // non-descendant (disjoint subtrees), so one batched query's union equals the per-root sum.
    const subtreeItems = knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true })
    const rootIdSet = new Set(rootItemIds)
    const roots = subtreeItems.filter((item) => rootIdSet.has(item.id))

    // Reindex re-acquires from the real source and then deletes the subtree's vectors
    // (reindexSubtreeJobHandler), so a root whose source is gone would lose its vectors with nothing
    // to rebuild from — reject up front. Only the root's own source matters: a directory is rescanned
    // from data.source and its children recreated, a file leaf re-copies its own data.source, and
    // note/url re-acquire from the DB / network. A v1-migrated folder child reindexed on its own is a
    // file root pointing at a path outside any base, so this rejects it too. Distinguish a genuinely
    // missing source (delete-and-re-add) from one we could not verify (transient/permission error,
    // which should retry rather than be destroyed).
    const sourceStates = await Promise.all(roots.map((root) => classifyKnowledgeItemReacquireSource(root)))

    const missingSourceItemIds: string[] = []
    const unverifiableSourceItemIds: string[] = []
    roots.forEach((root, index) => {
      if (sourceStates[index] === 'missing') {
        missingSourceItemIds.push(root.id)
      } else if (sourceStates[index] === 'unverifiable') {
        unverifiableSourceItemIds.push(root.id)
      }
    })

    if (missingSourceItemIds.length > 0) {
      throw DataApiErrorFactory.validation(
        {
          item: [`Knowledge item source no longer exists on disk for ${missingSourceItemIds.length} item(s)`]
        },
        'Cannot reindex a knowledge item whose source file or folder no longer exists; delete it and add it again to rebuild'
      )
    }

    if (unverifiableSourceItemIds.length > 0) {
      throw DataApiErrorFactory.validation(
        {
          item: [`Could not verify the knowledge item source on disk for ${unverifiableSourceItemIds.length} item(s)`]
        },
        'Could not verify the knowledge item source (it may be temporarily unavailable); please try again'
      )
    }
  }

  /** Reject while any item of the given subtrees is still running or being deleted. */
  private assertSubtreesSettled(subtreeItems: KnowledgeItem[]): void {
    const blockingStatusCounts = new Map<KnowledgeItemStatus, number>()
    for (const item of subtreeItems) {
      if (REINDEX_ALLOWED_STATUSES.has(item.status)) {
        continue
      }
      blockingStatusCounts.set(item.status, (blockingStatusCounts.get(item.status) ?? 0) + 1)
    }

    if (blockingStatusCounts.size === 0) {
      return
    }

    const statusSummary = [...blockingStatusCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `${status}=${count}`)
      .join(', ')

    throw DataApiErrorFactory.validation(
      {
        item: [`Knowledge item subtree is still running or being deleted: ${statusSummary}`]
      },
      'Cannot reindex knowledge item until the entire subtree is completed or failed'
    )
  }

  private rollbackAcceptedItems(baseId: string, items: KnowledgeItem[], originalError: unknown): void {
    for (const item of items) {
      try {
        knowledgeItemService.delete(item.id)
      } catch (cleanupError) {
        logger.error(
          'Failed to rollback accepted knowledge item after addItems failure',
          cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
          {
            baseId,
            itemId: item.id,
            addError: originalError instanceof Error ? originalError.message : String(originalError)
          }
        )
      }
    }
  }

  /** Reserve an input's `raw/` names and return the row to create plus the byte copies it is owed. */
  private planRuntimeAddItemInput(
    fileProcessorId: string | null | undefined,
    input: KnowledgeAddItemInput,
    reservedPaths: Set<string>
  ): { createInput: CreateKnowledgeItemDto; copies: KnowledgeSourceCopy[] } {
    if (input.type === 'url') {
      if (!input.data.snapshotPath) {
        return { createInput: input, copies: [] }
      }
      // Restore: copy the captured snapshot markdown into this base under a
      // collision-free name and pin the item to it, so the first index reads the
      // snapshot offline (see ensureSnapshot) instead of re-fetching the page.
      const snapshotName = getKnowledgeSourceRelativePath(input.data.snapshotPath)
      const relativePath = reserveImportedFileRelativePath(snapshotName, false, reservedPaths)
      return {
        createInput: {
          groupId: input.groupId,
          type: 'url',
          data: { source: input.data.source, url: input.data.url, relativePath }
        },
        copies: [{ from: input.data.snapshotPath, relativePath }]
      }
    }

    if (input.type !== 'file') {
      return { createInput: input, copies: [] }
    }

    assertSupportedKnowledgeFilePath(input.data.path)
    const fileName = getKnowledgeSourceRelativePath(input.data.path)
    // A restore that carries a processed artifact reserves the artifact slot too, even if
    // the destination base has no processor configured, so the copied `.md` cannot collide.
    const reserveArtifact =
      needsProcessedArtifactReservation(fileProcessorId, fileName) || Boolean(input.data.indexedPath)
    const relativePath = reserveImportedFileRelativePath(fileName, reserveArtifact, reservedPaths)
    const sourceCopy: KnowledgeSourceCopy = { from: input.data.path, relativePath }

    if (input.data.indexedPath) {
      // Copy the already-processed artifact next to the source under the reserved name
      // and pin the item to it, so indexing skips the file processor (see needsFileProcessing).
      const indexedRelativePath = getProcessedMarkdownRelativePath(relativePath)
      return {
        createInput: {
          groupId: input.groupId,
          type: 'file',
          data: { source: input.data.source, relativePath, indexedRelativePath }
        },
        copies: [sourceCopy, { from: input.data.indexedPath, relativePath: indexedRelativePath }]
      }
    }

    return {
      createInput: {
        groupId: input.groupId,
        type: 'file',
        data: {
          source: input.data.source,
          relativePath
        }
      },
      copies: [sourceCopy]
    }
  }

  private loadReservedKnowledgeFilePaths(baseId: string, fileProcessorId: string | null | undefined): Set<string> {
    // A deleting row's pending cleanup still unlinks its paths, so a new item must not claim them.
    const items = knowledgeItemService.getItemsByBaseId(baseId, { includeDeleting: true })
    return collectKnowledgeReservedRelativePaths(items, { fileProcessorId })
  }

  private assertKnowledgeRelativePathNotReserved(
    baseId: string,
    fileProcessorId: string | null | undefined,
    itemId: string,
    relativePath: string
  ): void {
    // A deleting row's pending cleanup still unlinks its paths, so the processed output must not claim them.
    const items = knowledgeItemService.getItemsByBaseId(baseId, { includeDeleting: true })
    const reserved = collectKnowledgeReservedRelativePaths(items, { fileProcessorId, excludeItemId: itemId })
    if (reserved.has(relativePath)) {
      throw new Error(`Knowledge file already exists: ${relativePath}`)
    }
  }

  private markUnscheduledAcceptedItemsFailed(
    baseId: string,
    items: KnowledgeItem[],
    completedSchedulingItemIds: Set<string>,
    originalError: unknown
  ): void {
    const message = originalError instanceof Error ? originalError.message : String(originalError)
    markUnscheduledKnowledgeItemsFailed({
      baseId,
      items,
      completedItemIds: completedSchedulingItemIds,
      errorMessage: message,
      failedStatusError: `Failed to schedule knowledge item job: ${message}`,
      logger,
      logMessage: 'Failed to mark unscheduled knowledge item after addItems scheduling failure'
    })
  }
}

function assertSupportedKnowledgeFilePath(filePath: string): void {
  if (!KNOWLEDGE_SUPPORTED_FILE_EXT_SET.has(getFileExt(filePath).toLowerCase())) {
    throw new Error(`Unsupported knowledge file type: ${filePath}`)
  }
}
