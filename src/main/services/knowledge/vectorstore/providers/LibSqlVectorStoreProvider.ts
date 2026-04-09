import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { sanitizeFilename } from '@main/utils/file'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { BaseVectorStore } from '@vectorstores/core'
import { LibSQLVectorStore } from '@vectorstores/libsql'

import type { BaseVectorStoreProvider } from './BaseVectorStoreProvider'

const logger = loggerService.withContext('LibSqlVectorStoreProvider')

export class LibSqlVectorStoreProvider implements BaseVectorStoreProvider {
  async create(base: KnowledgeBase): Promise<BaseVectorStore> {
    const dbPath = await this.getKnowledgeBaseFilePath(base.id)

    return new LibSQLVectorStore({
      collection: base.id,
      dimensions: base.dimensions,
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

  private async getKnowledgeBaseFilePath(baseId: string): Promise<string> {
    return application.getPath('feature.knowledgebase.data', sanitizeFilename(baseId, '_'))
  }
}

export const libSqlVectorStoreProvider = new LibSqlVectorStoreProvider()
