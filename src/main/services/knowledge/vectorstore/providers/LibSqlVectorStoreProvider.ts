import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getDataPath } from '@main/utils'
import { sanitizeFilename } from '@main/utils/file'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { BaseVectorStore } from '@vectorstores/core'
import { LibSQLVectorStore } from '@vectorstores/libsql'

export class LibSqlVectorStoreProvider {
  create(base: KnowledgeBase): BaseVectorStore {
    return new LibSQLVectorStore({
      collection: base.id,
      dimensions: base.dimensions,
      clientConfig: this.createKnowledgeBaseClientConfig(base.id)
    })
  }

  private createKnowledgeBaseClientConfig(baseId: string): { url: string } {
    const rootDir = path.join(getDataPath(), 'KnowledgeBase')
    if (!fs.existsSync(rootDir)) {
      fs.mkdirSync(rootDir, { recursive: true })
    }

    const dbPath = path.resolve(rootDir, sanitizeFilename(baseId, '_'))

    return {
      url: pathToFileURL(dbPath).toString()
    }
  }
}
