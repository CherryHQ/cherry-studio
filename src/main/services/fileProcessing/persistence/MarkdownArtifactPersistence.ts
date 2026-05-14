import { application } from '@application'
import { loggerService } from '@logger'
import type { FileProcessingArtifact } from '@shared/data/types/fileProcessing'
import type { FilePath } from '@shared/file/types'

import {
  cleanupFileProcessingResultsDir,
  type MarkdownPersistencePayload,
  markdownResultStore
} from './MarkdownResultStore'

const logger = loggerService.withContext('MarkdownArtifactPersistence')

class MarkdownArtifactPersistence {
  async persistArtifact(options: {
    taskId: string
    result: MarkdownPersistencePayload
    signal?: AbortSignal
  }): Promise<FileProcessingArtifact> {
    let markdownPath: FilePath | undefined

    try {
      markdownPath = await markdownResultStore.persistResult(options)

      const entry = await application.get('FileManager').createInternalEntry({
        source: 'path',
        path: markdownPath
      })

      return {
        kind: 'file',
        format: 'markdown',
        fileEntryId: entry.id
      }
    } finally {
      const cleaned = await cleanupFileProcessingResultsDir(options.taskId)

      if (cleaned) {
        logger.debug('Cleaned up file processing markdown staging directory', {
          taskId: options.taskId,
          markdownPath
        })
      }
    }
  }
}

export const markdownArtifactPersistence = new MarkdownArtifactPersistence()
