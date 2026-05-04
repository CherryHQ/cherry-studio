import { loggerService } from '@logger'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'

import { downloadImages } from '../utils/downloadImages'
import { normalizePaintingGenerateError } from './paintingGenerateError'

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
    files = await Promise.all(result.base64s.map((b64) => window.api.file.saveBase64Image(b64)))
  } else if ('urls' in result && result.urls.length > 0) {
    files = await downloadImages(result.urls, result.downloadOptions)
  }

  if (files.length > 0) {
    await FileManager.addFiles(files)
  }

  return files
}

export async function runPainting(
  generate: () => Promise<GenerationResult | FileMetadata[] | void>
): Promise<FileMetadata[]> {
  try {
    const result = await generate()
    if (!result) {
      return []
    }
    if (Array.isArray(result)) {
      await FileManager.addFiles(result)
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
