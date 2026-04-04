import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getDataPath } from '@main/utils'
import { sanitizeFilename } from '@main/utils/file'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { BaseVectorStore } from '@vectorstores/core'
import { LibSQLVectorStore } from '@vectorstores/libsql'

export class LibSqlVectorStoreProvider {
  async createBase(base: KnowledgeBase): Promise<BaseVectorStore> {
    this.ensureKnowledgeBaseRootDir()
    const dbPath = this.getKnowledgeBaseFilePath(base)
    return new LibSQLVectorStore({
      collection: base.id,
      dimensions: base.dimensions,
      clientConfig: {
        url: pathToFileURL(dbPath).toString()
      }
    })
  }

  async deleteBase(base: KnowledgeBase): Promise<void> {
    const dbPath = this.getKnowledgeBaseFilePath(base)

    try {
      await fs.promises.rm(dbPath, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  private getKnowledgeBaseRootDir(): string {
    return path.join(getDataPath(), 'KnowledgeBase')
  }

  private getKnowledgeBaseFilePath(base: Pick<KnowledgeBase, 'id'>): string {
    return path.resolve(this.getKnowledgeBaseRootDir(), sanitizeFilename(base.id, '_'))
  }

  private ensureKnowledgeBaseRootDir(): void {
    const rootDir = this.getKnowledgeBaseRootDir()
    if (!fs.existsSync(rootDir)) {
      fs.mkdirSync(rootDir, { recursive: true })
    }
  }
}
