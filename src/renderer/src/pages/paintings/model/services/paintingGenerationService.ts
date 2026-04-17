import { loggerService } from '@logger'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'

import type { GenerateContext } from '../../providers/shared/provider'
import { downloadImages } from '../../utils/downloadImages'
import { normalizePaintingGenerateError } from '../errors/paintingGenerateError'
import type { PaintingData } from '../types/paintingData'

const logger = loggerService.withContext('paintings/runPainting')

export type GenerationResult =
  | { urls: string[]; downloadOptions?: { allowBase64DataUrls?: boolean; showProxyWarning?: boolean } }
  | { base64s: string[] }
  | { files: FileMetadata[] }

export async function processPaintingResult(ctx: GenerateContext, result: GenerationResult): Promise<FileMetadata[]> {
  const {
    writers: { patchPainting, setFallbackUrls }
  } = ctx

  let files: FileMetadata[] = []

  if ('files' in result) {
    files = result.files
  } else if ('base64s' in result) {
    files = await Promise.all(result.base64s.map((b64) => window.api.file.saveBase64Image(b64)))
  } else if ('urls' in result && result.urls.length > 0) {
    files = await downloadImages(result.urls, result.downloadOptions)
    setFallbackUrls(result.urls)
  }

  if (files.length > 0) {
    await FileManager.addFiles(files)
    patchPainting({ files } as Partial<PaintingData>)
  }

  return files
}

export async function runPainting(
  ctx: GenerateContext,
  generate: (ctx: GenerateContext) => Promise<GenerationResult | void>
): Promise<void> {
  const {
    writers: { setIsLoading }
  } = ctx

  setIsLoading(true)

  try {
    const result = await generate(ctx)
    if (result) {
      await processPaintingResult(ctx, result)
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.name !== 'AbortError') {
      logger.error('Image generation failed:', error)
      throw normalizePaintingGenerateError(error)
    }
  } finally {
    setIsLoading(false)
  }
}
