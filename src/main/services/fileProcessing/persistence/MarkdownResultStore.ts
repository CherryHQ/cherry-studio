import path from 'node:path'

import { application } from '@application'
import { sanitizeFileProcessingRemoteUrl } from '@main/services/fileProcessing/utils/url'
import { net } from 'electron'

import { persistMarkdownResult, persistResponseZipResult } from './resultPersistence'

export type MarkdownPersistencePayload =
  | {
      kind: 'markdown'
      markdownContent: string
    }
  | {
      kind: 'remote-zip-url'
      downloadUrl: string
      configuredApiHost: string
    }
  | {
      kind: 'response-zip'
      response: Response
    }

export function getFileProcessingResultsDir(taskId: string): string {
  if (
    taskId.length === 0 ||
    path.isAbsolute(taskId) ||
    taskId === '.' ||
    taskId === '..' ||
    taskId.includes('/') ||
    taskId.includes('\\')
  ) {
    throw new Error(`Invalid file processing task id: ${taskId}`)
  }

  return path.join(application.getPath('feature.file_processing.results'), taskId)
}

class MarkdownResultStore {
  async persistResult(options: {
    taskId: string
    result: MarkdownPersistencePayload
    signal?: AbortSignal
  }): Promise<string> {
    const resultsDir = getFileProcessingResultsDir(options.taskId)

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
        const safeDownloadUrl = sanitizeFileProcessingRemoteUrl(
          options.result.downloadUrl,
          options.result.configuredApiHost
        )
        const response = await net.fetch(safeDownloadUrl, {
          method: 'GET',
          signal: options.signal
        })

        if (!response.ok) {
          const message = await response.text()
          throw new Error(`Markdown result download failed: ${response.status} ${response.statusText} ${message}`)
        }

        const contentType = response.headers.get('content-type')
        if (contentType !== 'application/zip') {
          throw new Error(`Markdown result download returned unexpected content-type: ${contentType}`)
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
