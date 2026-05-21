import { application } from '@application'
import { loggerService } from '@logger'
import type { FileEntryId } from '@shared/data/types/file'
import type { FileProcessingArtifact } from '@shared/data/types/fileProcessing'
import type { FilePath } from '@shared/file/types'

import type { FileProcessingHandlerOutput } from '../processors/types'
import {
  cleanupFileProcessingResultsDir,
  type MarkdownPersistencePayload,
  markdownResultStore
} from './MarkdownResultStore'

const logger = loggerService.withContext('FileProcessingArtifactPersistence')

class FileProcessingArtifactPersistence {
  async commitOutput(options: {
    taskId: string
    output: FileProcessingHandlerOutput
    signal?: AbortSignal
  }): Promise<FileProcessingArtifact[]> {
    switch (options.output.kind) {
      case 'text':
        return [
          {
            kind: 'text',
            format: 'plain',
            text: options.output.text
          }
        ]

      case 'markdown':
      case 'remote-zip-url':
      case 'response-zip':
        return [await this.persistMarkdownArtifact(options.taskId, options.output, options.signal)]
    }
  }

  private async rollbackFileEntryArtifact(taskId: string, fileEntryId: FileEntryId): Promise<void> {
    try {
      await application.get('FileManager').permanentDelete(fileEntryId)
    } catch (error) {
      logger.warn('Failed to rollback file processing file entry artifact', error as Error, {
        taskId,
        fileEntryId
      })
    }
  }

  private async persistMarkdownArtifact(
    taskId: string,
    result: MarkdownPersistencePayload,
    signal?: AbortSignal
  ): Promise<FileProcessingArtifact> {
    let markdownPath: FilePath | undefined
    let fileEntryId: FileEntryId | undefined

    try {
      markdownPath = await markdownResultStore.persistResult({
        taskId,
        result,
        signal
      })
      signal?.throwIfAborted()

      // Current artifact contract is markdown-only. ZIP sibling assets remain
      // staging-only and are discarded by the cleanup below.
      const entry = await application.get('FileManager').createInternalEntry({
        source: 'path',
        path: markdownPath
      })
      fileEntryId = entry.id
      signal?.throwIfAborted()

      return {
        kind: 'file',
        format: 'markdown',
        fileEntryId: entry.id
      }
    } catch (error) {
      if (fileEntryId) {
        await this.rollbackFileEntryArtifact(taskId, fileEntryId)
      }
      throw error
    } finally {
      const cleaned = await cleanupFileProcessingResultsDir(taskId)

      if (cleaned) {
        logger.debug('Cleaned up file processing markdown staging directory', {
          taskId,
          markdownPath
        })
      }
    }
  }
}

export const fileProcessingArtifactPersistence = new FileProcessingArtifactPersistence()
