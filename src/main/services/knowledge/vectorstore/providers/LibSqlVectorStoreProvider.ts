import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { isCompletedKnowledgeBase } from '@shared/data/types/knowledge'
import type { BaseVectorStore } from '@vectorstores/core'
import { LibSQLVectorStore } from '@vectorstores/libsql'

import {
  deleteKnowledgeBaseDir,
  getKnowledgeVectorStoreFilePath,
  getKnowledgeVectorStoreFilePathSync
} from '../../utils/storage/pathStorage'
import type { BaseVectorStoreProvider } from './BaseVectorStoreProvider'

const logger = loggerService.withContext('LibSqlVectorStoreProvider')

export class LibSqlVectorStoreProvider implements BaseVectorStoreProvider {
  async create(base: KnowledgeBase): Promise<BaseVectorStore> {
    if (!isCompletedKnowledgeBase(base)) {
      throw DataApiErrorFactory.invalidOperation(
        'createLibSqlVectorStore',
        `Knowledge base '${base.id}' is not ready for vector store operations`
      )
    }

    const dbPath = await getKnowledgeVectorStoreFilePath(base.id)

    return new LibSQLVectorStore({
      collection: base.id,
      dimensions: base.dimensions,
      clientConfig: {
        url: pathToFileURL(dbPath).toString()
      }
    })
  }

  /**
   * Remove the knowledge base's on-disk footprint. This deletes the entire base
   * directory (`feature.knowledgebase.data/{baseId}`) — the copied source files,
   * processed artifacts, and the `.cherry/index.sqlite` vector store alike — so
   * it is only safe as part of deleting the whole knowledge base, not for
   * resetting the vector index while keeping its sources.
   */
  async delete(baseId: string): Promise<void> {
    const dbPath = getKnowledgeVectorStoreFilePathSync(baseId)

    try {
      await deleteKnowledgeBaseDir(baseId)
    } catch (error) {
      logger.error('Failed to delete knowledge base directory', error as Error, {
        baseId,
        dbPath
      })
      throw error
    }
  }

  async exists(baseId: string): Promise<boolean> {
    const dbPath = getKnowledgeVectorStoreFilePathSync(baseId)

    try {
      const stat = await fs.promises.stat(dbPath)
      return stat.isFile()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }

      throw error
    }
  }
}

export const libSqlVectorStoreProvider = new LibSqlVectorStoreProvider()
