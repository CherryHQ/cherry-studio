import { application } from '@application'
import { loggerService } from '@logger'
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
  async persistArtifact(options: {
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

  async cleanupArtifacts(options: { taskId: string; artifacts?: FileProcessingArtifact[] }): Promise<void> {
    const fileEntryIds = options.artifacts?.flatMap((artifact) =>
      artifact.kind === 'file' ? [artifact.fileEntryId] : []
    )

    if (!fileEntryIds || fileEntryIds.length === 0) {
      return
    }

    const fileManager = application.get('FileManager')

    for (const fileEntryId of fileEntryIds) {
      try {
        await fileManager.permanentDelete(fileEntryId)
      } catch (error) {
        logger.warn('Failed to cleanup orphaned file processing file entry artifact', error as Error, {
          taskId: options.taskId,
          fileEntryId
        })
      }
    }
  }

  private async persistMarkdownArtifact(
    taskId: string,
    result: MarkdownPersistencePayload,
    signal?: AbortSignal
  ): Promise<FileProcessingArtifact> {
    let markdownPath: FilePath | undefined

    try {
      markdownPath = await markdownResultStore.persistResult({
        taskId,
        result,
        signal
      })

      // Current artifact contract is markdown-only. ZIP sibling assets remain
      // staging-only and are discarded by the cleanup below.
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
