import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { sanitizeFileProcessingRemoteUrl } from '@main/services/fileProcessing/utils/url'
import { pathExists } from '@main/utils/file'
import { net } from 'electron'

import { persistMarkdownResult, persistResponseZipResult } from './resultPersistence'

const logger = loggerService.withContext('MarkdownResultStore')

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

  // TODO(file-processing): Keep artifacts in the shared results root until the
  // file storage layout is finalized; move to the final per-file directory in
  // one filesystem pass instead of changing this path piecemeal.
  return path.join(application.getPath('feature.file_processing.results'), taskId)
}

export async function cleanupFileProcessingResultsDir(taskId: string): Promise<boolean> {
  const resultsDir = getFileProcessingResultsDir(taskId)

  try {
    if (!(await pathExists(resultsDir))) {
      return false
    }

    await fs.rm(resultsDir, { recursive: true, force: true })
    return true
  } catch (error) {
    logger.warn('Failed to cleanup file processing result directory', error as Error, {
      taskId,
      resultsDir
    })
    return false
  }
}

class MarkdownResultStore {
  async persistResult(options: {
    taskId: string
    result: MarkdownPersistencePayload
    signal?: AbortSignal
  }): Promise<string> {
    const resultsDir = getFileProcessingResultsDir(options.taskId)

    try {
      switch (options.result.kind) {
        case 'markdown':
          return await persistMarkdownResult({
            resultsDir,
            markdownContent: options.result.markdownContent
          })

        case 'response-zip':
          return await persistResponseZipResult({
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
            redirect: 'error',
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

          return await persistResponseZipResult({
            response,
            resultsDir,
            signal: options.signal
          })
        }
      }
    } catch (error) {
      logger.warn(
        'Markdown result persistence failed',
        getSafeMarkdownPersistenceErrorForLog(error),
        getMarkdownPersistenceLogContext(options, resultsDir)
      )
      throw error
    }
  }
}

export const markdownResultStore = new MarkdownResultStore()

function getMarkdownPersistenceLogContext(
  options: {
    taskId: string
    result: MarkdownPersistencePayload
  },
  resultsDir: string
): Record<string, unknown> {
  const context: Record<string, unknown> = {
    taskId: options.taskId,
    resultKind: options.result.kind,
    resultsDir
  }

  if (options.result.kind === 'remote-zip-url') {
    context.downloadUrl = redactUrlQuery(options.result.downloadUrl)
    context.configuredApiHost = options.result.configuredApiHost
  }

  return context
}

function redactUrlQuery(url: string): string {
  try {
    const parsedUrl = new URL(url)
    return `${parsedUrl.origin}${parsedUrl.pathname}`
  } catch {
    return '[invalid-url]'
  }
}

function getSafeMarkdownPersistenceErrorForLog(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error))
  }

  if (error.message.startsWith('Markdown result download failed:')) {
    const safeError = new Error('Markdown result download failed')
    safeError.name = error.name
    return safeError
  }

  return error
}
