import path from 'node:path'

import { application } from '@application'
import { sanitizeFileProcessingRemoteUrl } from '@main/services/fileProcessing/utils/url'
import { net } from 'electron'

import { persistMarkdownResult, persistResponseZipResult } from '../persistence/resultPersistence'
import type { MarkdownProviderCompletionPayload } from './types'

export function getFileProcessingResultsDir(fileId: string, taskId: string): string {
  return path.join(application.getPath('feature.files.data'), fileId, 'file-processing', taskId)
}

class MarkdownResultStore {
  async persistResult(options: {
    fileId: string
    taskId: string
    result: MarkdownProviderCompletionPayload
    signal?: AbortSignal
  }): Promise<string> {
    const resultsDir = getFileProcessingResultsDir(options.fileId, options.taskId)

    switch (options.result.kind) {
      case 'markdown':
        return persistMarkdownResult({
          resultsDir,
          markdownContent: options.result.markdownContent
        })

      case 'response-zip':
        return persistResponseZipResult({
          response: options.result.response,
          resultsDir,
          signal: options.signal
        })

      case 'remote-zip-url': {
        const safeDownloadUrl = sanitizeFileProcessingRemoteUrl(options.result.downloadUrl)
        const response = await net.fetch(safeDownloadUrl, {
          method: 'GET',
          signal: options.signal
        })

        if (!response.ok) {
          const message = await response.text()
          throw new Error(`Markdown result download failed: ${response.status} ${response.statusText} ${message}`)
        }

        return persistResponseZipResult({
          response,
          resultsDir,
          signal: options.signal
        })
      }
    }
  }
}

export const markdownResultStore = new MarkdownResultStore()
