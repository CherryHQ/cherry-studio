import path from 'node:path'

import { application } from '@application'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { KnowledgeBase, KnowledgeItemOf } from '@shared/data/types/knowledge'
import type { KeyedMutex } from '@shared/utils/async'
import { validateRenamedFileName } from '@shared/utils/file'

import { assertBaseCanRunRuntimeOperation } from '../base/baseGuards'
import {
  collectKnowledgeReservedRelativePaths,
  getProcessedMarkdownRelativePath,
  needsProcessedArtifactReservation,
  renameKnowledgeBaseFile
} from '../pathStorage'

const logger = loggerService.withContext('Knowledge:RenameItem')

const RENAME_ALLOWED_STATUSES = new Set(['completed', 'failed'])

const REASON_MESSAGES = {
  empty: 'The name cannot be empty',
  too_long: 'The name is too long (255 characters at most)',
  invalid: 'The name contains characters or a reserved name that is not allowed on Windows',
  extension_changed: 'The file extension must stay the same'
} as const

type FileItem = KnowledgeItemOf<'file'>

function fail(field: string, message: string): never {
  throw DataApiErrorFactory.validation({ [field]: [message] }, message)
}

function resolveRenameTargets(
  base: KnowledgeBase,
  item: FileItem,
  newRelativePath: string
): { from: string; to: string }[] {
  const { relativePath, indexedRelativePath } = item.data
  const moves = [{ from: relativePath, to: newRelativePath }]
  // Only the processed artifact that follows the source's naming moves with it.
  if (indexedRelativePath && indexedRelativePath === getProcessedMarkdownRelativePath(relativePath)) {
    moves.push({ from: indexedRelativePath, to: getProcessedMarkdownRelativePath(newRelativePath) })
  }

  const reserved = new Set(
    [
      ...collectKnowledgeReservedRelativePaths(
        knowledgeItemService.getItemsByBaseId(base.id, { includeDeleting: true }),
        {
          fileProcessorId: base.fileProcessorId,
          excludeItemId: item.id
        }
      )
    ].map((value) => value.toLowerCase())
  )
  const claimed = moves.map((move) => move.to)
  if (!indexedRelativePath && needsProcessedArtifactReservation(base.fileProcessorId, newRelativePath)) {
    claimed.push(getProcessedMarkdownRelativePath(newRelativePath))
  }
  if (claimed.some((value) => reserved.has(value.toLowerCase()))) {
    fail('name', 'A file with this name already exists in the knowledge base')
  }
  return moves
}

/**
 * Rename a file item's stored name in place. The bytes, indexed chunks/embeddings and `data.source`
 * are kept; only the `raw/` path (the item's display name and Concept ID) changes. Files, row and
 * index move together or not at all.
 */
export async function renameKnowledgeFileItem(
  knowledgeLockManager: KeyedMutex,
  baseId: string,
  itemId: string,
  name: string
): Promise<void> {
  const base = assertBaseCanRunRuntimeOperation(baseId, 'renameItem')

  await knowledgeLockManager.runExclusive(baseId, async () => {
    const item = knowledgeItemService.getById(itemId)
    if (item.baseId !== baseId) {
      throw DataApiErrorFactory.notFound('KnowledgeItem', itemId)
    }
    if (item.type !== 'file') {
      fail('item', 'Only files can be renamed')
    }
    if (!RENAME_ALLOWED_STATUSES.has(item.status)) {
      fail('item', 'The file can be renamed once indexing has finished')
    }

    const oldRelativePath = item.data.relativePath
    const dir = path.posix.dirname(oldRelativePath)
    const validation = validateRenamedFileName(path.posix.basename(oldRelativePath), name)
    if (!validation.valid) {
      fail('name', REASON_MESSAGES[validation.reason])
    }
    const newRelativePath = dir === '.' ? validation.name : `${dir}/${validation.name}`
    if (newRelativePath === oldRelativePath) {
      return
    }

    const moves = resolveRenameTargets(base, item, newRelativePath)
    const done: typeof moves = []
    const restoreFiles = async () => {
      for (const move of done.reverse()) {
        try {
          await renameKnowledgeBaseFile(baseId, move.to, move.from)
        } catch (error) {
          logger.error('Failed to restore knowledge file after a failed rename', error as Error, { baseId, itemId })
        }
      }
    }

    try {
      for (const move of moves) {
        await renameKnowledgeBaseFile(baseId, move.from, move.to)
        done.push(move)
      }
    } catch (error) {
      await restoreFiles()
      const code = (error as NodeJS.ErrnoException).code
      logger.warn('Knowledge file rename failed', { baseId, itemId, code })
      throw DataApiErrorFactory.invalidOperation(
        'rename knowledge file',
        `The file could not be renamed${code ? ` (${code})` : ''}. Close any program using it and try again.`
      )
    }

    const newIndexedRelativePath = moves.length > 1 ? moves[1].to : undefined
    const materialRelativePath = newIndexedRelativePath ?? item.data.indexedRelativePath ?? newRelativePath
    const store = application.get('KnowledgeVectorStoreService').getIndexStoreIfExists(base)
    let rowUpdated = false
    try {
      knowledgeItemService.updateFileRelativePaths(itemId, {
        relativePath: newRelativePath,
        ...(newIndexedRelativePath && { indexedRelativePath: newIndexedRelativePath })
      })
      rowUpdated = true
      store?.renameMaterial(itemId, materialRelativePath)
    } catch (error) {
      if (rowUpdated) {
        knowledgeItemService.updateFileRelativePaths(itemId, {
          relativePath: oldRelativePath,
          ...(newIndexedRelativePath && { indexedRelativePath: item.data.indexedRelativePath })
        })
      }
      await restoreFiles()
      throw error
    }
  })
}
