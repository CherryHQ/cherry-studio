import { loggerService } from '@logger'
import {
  createPaintingGenerateError,
  normalizePaintingGenerateError
} from '@renderer/aiCore/errors/paintingGenerateError'
import type { FileMetadata } from '@renderer/types'
import type { FileEntry } from '@shared/data/types/file/fileEntry'

import { downloadImages } from '../utils/downloadImages'

const logger = loggerService.withContext('paintings/generation')

export type GenerationResult =
  | { urls: string[]; downloadOptions?: { allowBase64DataUrls?: boolean; showProxyWarning?: boolean } }
  | { base64s: string[] }
  | { files: FileMetadata[] }

async function fileEntryToMetadata(entry: FileEntry): Promise<FileMetadata> {
  const path = await window.api.file.getPhysicalPath({ id: entry.id })
  const dottedExt = entry.ext ? `.${entry.ext}` : ''
  const fullName = `${entry.name}${dottedExt}`
  // `entry.size` only exists on the internal variant of FileEntry; painting
  // outputs always create internal entries via `source: 'base64' | 'url'`,
  // so the external branch is unreachable here but TS can't narrow without
  // an explicit check.
  const size = entry.origin === 'internal' ? entry.size : 0
  return {
    id: entry.id,
    name: fullName,
    origin_name: fullName,
    path,
    size,
    ext: dottedExt,
    type: 'image',
    created_at: new Date(entry.createdAt).toISOString(),
    count: 1
  }
}

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
