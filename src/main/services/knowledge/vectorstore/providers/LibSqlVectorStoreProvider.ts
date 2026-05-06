import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

import { application } from '@application'
import { loggerService } from '@logger'
import { sanitizeFilename } from '@main/utils/file'
import { DataApiErrorFactory } from '@shared/data/api'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { BaseVectorStore } from '@vectorstores/core'
import { LibSQLVectorStore } from '@vectorstores/libsql'

import type { BaseVectorStoreProvider } from './BaseVectorStoreProvider'

const logger = loggerService.withContext('LibSqlVectorStoreProvider')

export class LibSqlVectorStoreProvider implements BaseVectorStoreProvider {
  async create(base: KnowledgeBase): Promise<BaseVectorStore> {
    if (
      base.status !== 'completed' ||
      typeof base.dimensions !== 'number' ||
      !Number.isInteger(base.dimensions) ||
      base.dimensions <= 0
    ) {
      throw DataApiErrorFactory.invalidOperation(
        'createLibSqlVectorStore',
        `Knowledge base '${base.id}' is not ready for vector store operations`
      )
    }

    const dimensions = base.dimensions
    const dbPath = await this.getKnowledgeBaseFilePath(base.id)

    return new LibSQLVectorStore({
      collection: base.id,
      dimensions,
      clientConfig: {
        url: pathToFileURL(dbPath).toString()
      }
    })
  }

  async delete(baseId: string): Promise<void> {
    const dbPath = await this.getKnowledgeBaseFilePath(baseId)

    try {
      await fs.promises.rm(dbPath, { force: true })
    } catch (error) {
      logger.error('Failed to delete knowledge base vector store file', error as Error, {
        baseId,
        dbPath
      })
      throw error
    }
  }

  async exists(baseId: string): Promise<boolean> {
    const dbPath = await this.getKnowledgeBaseFilePath(baseId)

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

  private async getKnowledgeBaseFilePath(baseId: string): Promise<string> {
    return application.getPath('feature.knowledgebase.data', sanitizeFilename(baseId, '_'))
  }
}

export const libSqlVectorStoreProvider = new LibSqlVectorStoreProvider()
