import './jobs/jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { getFileExt } from '@main/utils/file'
import { FileProcessorIdSchema } from '@shared/data/presets/fileProcessing'
import {
  type CreateKnowledgeItemDto,
  DEFAULT_KNOWLEDGE_ADD_CONFLICT_STRATEGY,
  type KnowledgeAddConflictStrategy,
  type KnowledgeAddItemInput,
  type KnowledgeAddItemsResult,
  type KnowledgeBase,
  type KnowledgeItem
} from '@shared/data/types/knowledge'
import { knowledgeSupportedFileExts } from '@shared/utils/file'

import { cancelJobOrThrow } from './jobs/utils/cancel'
import type { KnowledgeLockManager } from './KnowledgeLockManager'
import {
  type KnowledgeBaseId,
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
} from './types'
import { resolveKnowledgeAddConflicts } from './utils/addConflicts'
import { markUnscheduledKnowledgeItemsFailed } from './utils/cleanup/statusCleanup'
import { cancelActiveKnowledgeSubtreeJobs, purgeKnowledgeSubtreeWithinLock } from './utils/cleanup/subtreePurge'
import { isContainerKnowledgeItem } from './utils/items'
import { planKnowledgeItemSource } from './utils/sources/sourcePlanning'
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
} from './utils/storage/pathStorage'

const logger = loggerService.withContext('Knowledge:WorkflowService')
// Keep poll jobs delayed enough to avoid hot-looping while remote processors are still working.
const FILE_PROCESSING_CHECK_DELAY_MS = 5_000
const KNOWLEDGE_SUPPORTED_FILE_EXT_SET = new Set<string>(knowledgeSupportedFileExts)

export class KnowledgeWorkflowService {
  constructor(private readonly knowledgeLockManager: KnowledgeLockManager) {}

  async addItems(
    baseId: string,
    inputs: KnowledgeAddItemInput[],
    conflictStrategy: KnowledgeAddConflictStrategy = DEFAULT_KNOWLEDGE_ADD_CONFLICT_STRATEGY
  ): Promise<KnowledgeAddItemsResult> {
    if (inputs.length === 0) {
      return { status: 'added' }
    }

    const base = await knowledgeBaseService.getById(baseId)

    // rename (the default, and every internal caller — restore/migrator): keep all,
    // auto-rename on collision. detect/replace first resolve same-name conflicts
    // against the existing root items and earlier items in the same batch.
    let itemsToAdd = inputs
    if (conflictStrategy !== 'rename') {
      const existingRoots = await knowledgeItemService.getRootItemsByBaseId(base.id)
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
          await cancelActiveKnowledgeSubtreeJobs(
            base.id,
            resolution.conflictingExistingRootIds,
            'knowledge-add-replace'
          )
        }
      }
    }

    const acceptedItems: KnowledgeItem[] = []
    const copiedFileItems: Array<Pick<CreateKnowledgeItemDto, 'type' | 'data'>> = []

    await this.knowledgeLockManager.withBaseMutationLock(base.id, async () => {
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
        const reservedPaths = await this.loadReservedKnowledgeFilePaths(base.id, base.fileProcessorId)
        for (const input of itemsToAdd) {
          const createInput = await this.prepareRuntimeAddItemInput(base.id, base.fileProcessorId, input, reservedPaths)
          // A url restore copies its snapshot to raw/{relativePath} under type 'url',
          // so track it for rollback too — otherwise a mid-batch failure orphans the
          // snapshot and a same-titled re-restore later hard-fails on the leftover file
          // (the add-side twin of the delete-side leak fixed in deleteKnowledgeItemFiles).
          if (createInput.type === 'file' || (createInput.type === 'url' && createInput.data.relativePath)) {
            copiedFileItems.push(createInput)
          }
          const createdItem = await knowledgeItemService.create(base.id, createInput)
          acceptedItems.push(createdItem)
          const activeItem = await knowledgeItemService.updateStatus(
            createdItem.id,
            isContainerKnowledgeItem(createdItem) ? 'preparing' : 'processing'
          )
          acceptedItems[acceptedItems.length - 1] = activeItem
        }
      } catch (error) {
        await this.rollbackAcceptedItems(base.id, acceptedItems, error)
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
      for (const item of acceptedItems) {
        await this.scheduleItem(toKnowledgeBaseId(item.baseId), toKnowledgeItemId(item.id))
        completedSchedulingItemIds.add(item.id)
      }
    } catch (error) {
      await this.markUnscheduledAcceptedItemsFailed(base.id, acceptedItems, completedSchedulingItemIds, error)
      throw error
    }

    return { status: 'added' }
  }

  /**
   * Remove the existing root items (and their subtrees) whose name an incoming
   * source collides with, for the `replace` strategy. MUST run inside the base
   * mutation lock. Re-resolves conflicts against the current roots so a change in
   * the cancel->lock gap is honored; the in-flight jobs were already cancelled by
   * the caller outside the lock.
   */
  private async purgeConflictingExistingItems(base: KnowledgeBase, itemsToAdd: KnowledgeAddItemInput[]): Promise<void> {
    const currentRoots = await knowledgeItemService.getRootItemsByBaseId(base.id)
    const { conflictingExistingRootIds } = resolveKnowledgeAddConflicts(itemsToAdd, currentRoots)
    if (conflictingExistingRootIds.length === 0) {
      return
    }
    const subtreeItems = await knowledgeItemService.getSubtreeItems(base.id, conflictingExistingRootIds, {
      includeRoots: true
    })
    await purgeKnowledgeSubtreeWithinLock(base, subtreeItems, { baseId: base.id, reason: 'knowledge-add-replace' })
  }

  async deleteItems(baseId: string, itemIds: string[]): Promise<void> {
    await knowledgeBaseService.getById(baseId)
    const rootItemIds = [...new Set(itemIds)]
    const knowledgeBaseId = toKnowledgeBaseId(baseId)
    const knowledgeRootItemIds = toKnowledgeItemIds(rootItemIds)
    const markedIds = await this.knowledgeLockManager.withBaseMutationLock(baseId, () =>
      knowledgeItemService.setSubtreeStatus(baseId, rootItemIds, 'deleting')
    )
    try {
      const jobManager = application.get('JobManager')
      await jobManager.enqueue(
        'knowledge.delete-subtree',
        { baseId, rootItemIds },
        {
          idempotencyKey: knowledgeDeleteSubtreeIdempotencyKey(knowledgeBaseId, knowledgeRootItemIds),
          queue: knowledgeQueueName(knowledgeBaseId)
        }
      )
    } catch (error) {
      logger.error('Failed to enqueue knowledge delete cleanup after marking items deleting', error as Error, {
        baseId,
        rootItemIds,
        markedIds
      })
      throw error
    }
  }

  async reindexItems(baseId: string, itemIds: string[]): Promise<void> {
    await knowledgeBaseService.getById(baseId)
    const rootItemIds = [...new Set(itemIds)]
    const knowledgeBaseId = toKnowledgeBaseId(baseId)
    const knowledgeRootItemIds = toKnowledgeItemIds(rootItemIds)
    const jobManager = application.get('JobManager')
    await jobManager.enqueue(
      'knowledge.reindex-subtree',
      { baseId, rootItemIds },
      {
        idempotencyKey: knowledgeReindexSubtreeIdempotencyKey(knowledgeBaseId, knowledgeRootItemIds),
        queue: knowledgeQueueName(knowledgeBaseId)
      }
    )
  }

  async scheduleItem(
    baseId: KnowledgeBaseId,
    itemId: KnowledgeItemId,
    parentJobId: string | null = null
  ): Promise<void> {
    const base = await knowledgeBaseService.getById(baseId)
    const item = await knowledgeItemService.getById(itemId)
    if (item.baseId !== baseId) {
      throw new Error(`Knowledge item '${itemId}' does not belong to base '${baseId}'`)
    }
    if (item.status === 'deleting') {
      return
    }

    const plan = planKnowledgeItemSource(base, item)
    if (plan.kind === 'invalid') {
      await knowledgeItemService.updateStatus(itemId, 'failed', { error: plan.reason })
      return
    }

    const jobManager = application.get('JobManager')
    if (plan.kind === 'prepare-root') {
      await jobManager.enqueue(
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
        await this.assertKnowledgeRelativePathNotReserved(baseId, base.fileProcessorId, item.id, processedRelativePath)
        await assertKnowledgeFileTargetAvailable(baseId, processedRelativePath)
      }
      const processedPath = getKnowledgeBaseFilePath(baseId, processedRelativePath)
      const fileProcessingJob = await fileProcessing.startJob(
        {
          feature: 'document_to_markdown',
          file: { kind: 'path', path: sourcePath },
          output: { kind: 'path', path: processedPath },
          context: { dataId: item.id },
          processorId
        },
        {
          parentId: parentJobId ?? undefined
        }
      )
      try {
        await this.scheduleFileProcessingCheck(baseId, itemId, fileProcessingJob.id, {
          pollRound: 0,
          firstScheduledAt: Date.now(),
          // Use the file-processing job as workflow parent when this is a direct add flow,
          // so retries keep a stable index idempotency key across poll rounds.
          parentJobId: parentJobId ?? fileProcessingJob.id
        })
      } catch (error) {
        try {
          await cancelJobOrThrow(fileProcessingJob.id, 'knowledge-file-processing-check-enqueue-failed')
        } catch (cancelError) {
          logger.warn('Failed to cancel file-processing job after check enqueue failure', {
            fileProcessingJobId: fileProcessingJob.id,
            cancelError: cancelError instanceof Error ? cancelError.message : String(cancelError)
          })
        }
        throw error
      }
      return
    }

    await jobManager.enqueue(
      'knowledge.index-documents',
      { baseId, itemId, parentJobId },
      {
        idempotencyKey: knowledgeIndexIdempotencyKey(baseId, itemId, parentJobId),
        queue: knowledgeQueueName(baseId),
        parentId: parentJobId ?? undefined
      }
    )
  }

  async scheduleFileProcessingCheck(
    baseId: KnowledgeBaseId,
    itemId: KnowledgeItemId,
    fileProcessingJobId: string,
    options: { pollRound: number; firstScheduledAt: number; parentJobId: string | null }
  ): Promise<void> {
    const { pollRound, firstScheduledAt, parentJobId } = options
    const jobManager = application.get('JobManager')
    await jobManager.enqueue(
      'knowledge.check-file-processing-result',
      {
        baseId,
        itemId,
        fileProcessingJobId,
        pollRound,
        firstScheduledAt,
        parentJobId
      },
      {
        idempotencyKey: knowledgeFileProcessingCheckIdempotencyKey(baseId, itemId, fileProcessingJobId, pollRound),
        queue: knowledgeQueueName(baseId),
        parentId: parentJobId ?? undefined,
        scheduledAt: Date.now() + FILE_PROCESSING_CHECK_DELAY_MS
      }
    )
  }

  async scheduleIndexing(
    baseId: KnowledgeBaseId,
    itemId: KnowledgeItemId,
    parentJobId: string | null = null
  ): Promise<void> {
    const jobManager = application.get('JobManager')
    await jobManager.enqueue(
      'knowledge.index-documents',
      { baseId, itemId, parentJobId },
      {
        idempotencyKey: knowledgeIndexIdempotencyKey(baseId, itemId, parentJobId),
        queue: knowledgeQueueName(baseId),
        parentId: parentJobId ?? undefined
      }
    )
  }

  private async rollbackAcceptedItems(baseId: string, items: KnowledgeItem[], originalError: unknown): Promise<void> {
    for (const item of items) {
      try {
        await knowledgeItemService.delete(item.id)
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

  private async prepareRuntimeAddItemInput(
    baseId: string,
    fileProcessorId: string | null | undefined,
    input: KnowledgeAddItemInput,
    reservedPaths: Set<string>
  ): Promise<CreateKnowledgeItemDto> {
    if (input.type === 'url') {
      if (!input.data.snapshotPath) {
        return input
      }
      // Restore: copy the captured snapshot markdown into this base under a
      // collision-free name and pin the item to it, so the first index reads the
      // snapshot offline (see ensureUrlSnapshot) instead of re-fetching the page.
      const snapshotName = getKnowledgeSourceRelativePath(input.data.snapshotPath)
      const relativePath = reserveImportedFileRelativePath(snapshotName, false, reservedPaths)
      await copyFileIntoKnowledgeBaseAt(baseId, input.data.snapshotPath, relativePath)
      return {
        groupId: input.groupId,
        type: 'url',
        data: { source: input.data.source, url: input.data.url, relativePath }
      }
    }

    if (input.type !== 'file') {
      return input
    }

    assertSupportedKnowledgeFilePath(input.data.path)
    const fileName = getKnowledgeSourceRelativePath(input.data.path)
    // A restore that carries a processed artifact reserves the artifact slot too, even if
    // the destination base has no processor configured, so the copied `.md` cannot collide.
    const reserveArtifact =
      needsProcessedArtifactReservation(fileProcessorId, fileName) || Boolean(input.data.indexedPath)
    const relativePath = reserveImportedFileRelativePath(fileName, reserveArtifact, reservedPaths)
    await copyFileIntoKnowledgeBaseAt(baseId, input.data.path, relativePath)

    if (input.data.indexedPath) {
      // Copy the already-processed artifact next to the source under the reserved name
      // and pin the item to it, so indexing skips the file processor (see needsFileProcessing).
      const indexedRelativePath = getProcessedMarkdownRelativePath(relativePath)
      await copyFileIntoKnowledgeBaseAt(baseId, input.data.indexedPath, indexedRelativePath)
      return {
        groupId: input.groupId,
        type: 'file',
        data: { source: input.data.source, relativePath, indexedRelativePath }
      }
    }

    return {
      groupId: input.groupId,
      type: 'file',
      data: {
        source: input.data.source,
        relativePath
      }
    }
  }

  private async loadReservedKnowledgeFilePaths(
    baseId: string,
    fileProcessorId: string | null | undefined
  ): Promise<Set<string>> {
    const items = await knowledgeItemService.getItemsByBaseId(baseId)
    return collectKnowledgeReservedRelativePaths(items, { fileProcessorId })
  }

  private async assertKnowledgeRelativePathNotReserved(
    baseId: string,
    fileProcessorId: string | null | undefined,
    itemId: string,
    relativePath: string
  ): Promise<void> {
    const items = await knowledgeItemService.getItemsByBaseId(baseId)
    const reserved = collectKnowledgeReservedRelativePaths(items, { fileProcessorId, excludeItemId: itemId })
    if (reserved.has(relativePath)) {
      throw new Error(`Knowledge file already exists: ${relativePath}`)
    }
  }

  private async markUnscheduledAcceptedItemsFailed(
    baseId: string,
    items: KnowledgeItem[],
    completedSchedulingItemIds: Set<string>,
    originalError: unknown
  ): Promise<void> {
    const message = originalError instanceof Error ? originalError.message : String(originalError)
    await markUnscheduledKnowledgeItemsFailed({
      baseId,
      items,
      completedItemIds: completedSchedulingItemIds,
      errorMessage: message,
      failedStatusError: `Failed to schedule knowledge item job: ${message}`,
      logger,
      logMessage: 'Failed to mark unscheduled knowledge item after addItems scheduling failure',
      logContextKey: 'scheduleError'
    })
  }
}

function assertSupportedKnowledgeFilePath(filePath: string): void {
  if (!KNOWLEDGE_SUPPORTED_FILE_EXT_SET.has(getFileExt(filePath).toLowerCase())) {
    throw new Error(`Unsupported knowledge file type: ${filePath}`)
  }
}
