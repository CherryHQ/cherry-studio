import { loggerService } from '@logger'
import {
  createPaintingGenerateError,
  normalizePaintingGenerateError
} from '@renderer/aiCore/errors/paintingGenerateError'
import type { FileMetadata } from '@renderer/types'

import { downloadImages } from '../utils/downloadImages'
import { fileEntryToMetadata } from '../utils/fileEntryAdapter'

const logger = loggerService.withContext('paintings/generation')

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
          data: `data:image/png;base64,${b64}`
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
      logger.error('Image generation failed:', error)
      throw normalizePaintingGenerateError(error)
    }
    throw error
  }
}
