import { net } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { atomicWriteFile } from '@main/utils/file'
import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import type { AbsoluteFilePath } from '@shared/types/file'
import { redactUrlToOrigin } from '@shared/utils/redaction'

import { readMarkdownFromResponseZip } from './resultPersistence'

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

class MarkdownResultStore {
  async persistResultToPath(options: {
    jobId: string
    result: MarkdownPersistencePayload
    path: AbsoluteFilePath
    signal?: AbortSignal
  }): Promise<AbsoluteFilePath> {
    try {
      const data = await this.resolveMarkdownBytes(options)
      await atomicWriteFile(options.path, data)
      return options.path
    } catch (error) {
      logger.warn(
        'Markdown result path persistence failed',
        getSafeMarkdownPersistenceErrorForLog(error),
        getMarkdownPersistenceLogContext(options)
      )
      throw error
    }
  }

  private async resolveMarkdownBytes(options: {
    result: MarkdownPersistencePayload
    signal?: AbortSignal
  }): Promise<Uint8Array> {
    switch (options.result.kind) {
      case 'markdown':
        return new TextEncoder().encode(options.result.markdownContent)

      case 'response-zip':
        return await this.readMarkdownFromZipResponse(options.result.response, options.signal)

      case 'remote-zip-url': {
        const safeDownloadUrl = sanitizeRemoteUrl(options.result.downloadUrl, options.result.configuredApiHost)
        const response = await net.fetch(safeDownloadUrl, {
          method: 'GET',
          redirect: 'error',
          signal: options.signal
        })

        if (!response.ok) {
          throw new Error(`Markdown result download failed: ${response.status} ${response.statusText}`)
        }

        const contentType = response.headers.get('content-type')
        if (contentType !== 'application/zip') {
          throw new Error(`Markdown result download returned unexpected content-type: ${contentType}`)
        }

        return await this.readMarkdownFromZipResponse(response, options.signal)
      }
    }
  }

  private async readMarkdownFromZipResponse(response: Response, signal?: AbortSignal): Promise<Uint8Array> {
    return await readMarkdownFromResponseZip({
      response,
      tempDir: application.getPath('feature.file_processing.temp'),
      signal
    })
  }
}

export const markdownResultStore = new MarkdownResultStore()

function getMarkdownPersistenceLogContext(options: { jobId: string; result: MarkdownPersistencePayload }) {
  const context = {
    jobId: options.jobId,
    resultKind: options.result.kind
  }

  if (options.result.kind === 'remote-zip-url') {
    return {
      ...context,
      downloadUrl: redactUrlToOrigin(options.result.downloadUrl),
      configuredApiHost: options.result.configuredApiHost
    }
  }

  return context
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Download and persistence failures are untyped; logging must redact remote download details without replacing the original rejection.
function getSafeMarkdownPersistenceErrorForLog(error: unknown): Error {
  try {
    if (!(error instanceof Error)) return new Error(String(error))
    if (typeof error.message === 'string' && error.message.startsWith('Markdown result download failed:')) {
      const safeError = new Error('Markdown result download failed')
      safeError.name = typeof error.name === 'string' ? error.name : 'Error'
      return safeError
    }
    return error
  } catch {
    return new Error('Markdown result persistence failed')
  }
}
