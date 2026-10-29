import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import type { FileMetadata } from '@renderer/types/file'
import { createPaintingGenerateError, normalizePaintingGenerateError } from '@shared/ai/paintingGenerateError'
import { aiErrorDetail } from '@shared/ipc/errors/ai'
import type { SerializedError } from '@shared/types/error'

import { downloadImages } from '../utils/downloadImages'
import { fileEntryToMetadata } from '../utils/fileEntryAdapter'

const logger = loggerService.withContext('paintings/generation')

/** Concise human message from the serialized provider/AI-SDK error the
 *  `ai.image.generate` route attaches to its IpcError `data`: prefer the
 *  provider message, else the HTTP status, else a response-body snippet.
 *  A 504 maps to the friendly timeout string — gateway bodies are proxy noise. */
// Exhausted SDK retries arrive as RetryError with the terminal failure in lastError
// (or the final errors[] entry). Classify that terminal shape only — not earlier retries.
function terminalSerializedError(detail: SerializedError): SerializedError {
  if (typeof detail.lastError === 'object' && detail.lastError !== null) {
    return detail.lastError as SerializedError
  }
  const errors = detail.errors
  if (Array.isArray(errors) && errors.length > 0) {
    const final = errors[errors.length - 1]
    if (typeof final === 'object' && final !== null) {
      return final as SerializedError
    }
  }
  return detail
}

function serializedErrorFallbackMessage(error: SerializedError): string {
  const status = typeof error.statusCode === 'number' ? `HTTP ${error.statusCode}` : ''
  const body = typeof error.responseBody === 'string' ? error.responseBody.slice(0, 300) : ''
  return [status, body].filter(Boolean).join(' ') || error.name || ''
}

function aiDetailMessage(detail: SerializedError): string {
  const terminal = terminalSerializedError(detail)
  if (terminal.statusCode === 504) return i18n.t('error.http.504')
  if (terminal.message) return terminal.message
  const terminalFallback = serializedErrorFallbackMessage(terminal)
  if (terminalFallback) return terminalFallback
  if (detail.message) return detail.message
  return serializedErrorFallbackMessage(detail) || 'Image generation failed'
}

export type GenerationResult =
  | { urls: string[]; downloadOptions?: { allowBase64DataUrls?: boolean; showProxyWarning?: boolean } }
  | { base64s: string[] }
  | { files: FileMetadata[] }

export async function resolvePaintingFiles(result: GenerationResult): Promise<FileMetadata[]> {
  let files: FileMetadata[] = []

  if ('files' in result) {
    files = result.files
  } else if ('base64s' in result) {
    const entries = await Promise.all(
      result.base64s.map((b64) =>
        window.api.file.createInternalEntry({
          source: 'base64',
          data: `data:image/png;base64,${b64}`,
          cleanupPolicy: 'delete_when_unreferenced'
        })
      )
    )
    files = await Promise.all(entries.map(fileEntryToMetadata))
  } else if ('urls' in result && result.urls.length > 0) {
    files = await downloadImages(result.urls, result.downloadOptions)
  }

  if (files.length === 0) {
    throw createPaintingGenerateError('GENERATE_FAILED')
  }

  return files
}

export async function runPainting(
  generate: () => Promise<GenerationResult | FileMetadata[] | void>
): Promise<FileMetadata[]> {
  try {
    const result = await generate()
    if (!result) {
      throw createPaintingGenerateError('GENERATE_FAILED')
    }
    if (Array.isArray(result)) {
      if (result.length === 0) {
        throw createPaintingGenerateError('GENERATE_FAILED')
      }
      return result
    }
    return resolvePaintingFiles(result)
  } catch (error: unknown) {
    if (error instanceof Error && error.name !== 'AbortError') {
      // `ai.image.generate` wraps a provider/SDK failure as an AI_REQUEST_FAILED
      // IpcError carrying the full serialized error (statusCode / responseBody) in
      // `data`. Recover it so the log AND the user-facing modal show the real cause
      // instead of collapsing to an empty `REMOTE_ERROR`.
      const detail = aiErrorDetail(error)
      logger.error('Image generation failed:', detail ?? error)
      if (detail) {
        throw createPaintingGenerateError('REMOTE_ERROR', { message: aiDetailMessage(detail) })
      }
      throw normalizePaintingGenerateError(error)
    }
    throw error
  }
}
