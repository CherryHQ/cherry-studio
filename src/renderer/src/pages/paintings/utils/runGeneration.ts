import { loggerService } from '@logger'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata, PaintingCanvas } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils'

import type { GenerateContext } from '../providers/types'
import { downloadImages } from './downloadImages'

const logger = loggerService.withContext('paintings/runGeneration')

export type GenerationResult =
  | { urls: string[]; downloadOptions?: { allowBase64DataUrls?: boolean; showProxyWarning?: boolean } }
  | { base64s: string[] }
  | { files: FileMetadata[] }

export async function processResult(ctx: GenerateContext, result: GenerationResult): Promise<FileMetadata[]> {
  const { patchPainting, setFallbackUrls, t } = ctx

  let files: FileMetadata[] = []

  if ('files' in result) {
    files = result.files
  } else if ('base64s' in result) {
    files = await Promise.all(result.base64s.map((b64) => window.api.file.saveBase64Image(b64)))
  } else if ('urls' in result && result.urls.length > 0) {
    files = await downloadImages(result.urls, t, result.downloadOptions)
    setFallbackUrls(result.urls)
  }

  if (files.length > 0) {
    await FileManager.addFiles(files)
    patchPainting({ files } as Partial<PaintingCanvas>)
  }

  return files
}

export async function runGeneration(
  ctx: GenerateContext,
  generate: (ctx: GenerateContext) => Promise<GenerationResult | void>
): Promise<void> {
  const { setIsLoading } = ctx

  setIsLoading(true)

  try {
    const result = await generate(ctx)
    if (result) {
      await processResult(ctx, result)
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.name !== 'AbortError') {
      logger.error('Image generation failed:', error)
      window.modal.error({
        content: getErrorMessage(error),
        centered: true
      })
    }
  } finally {
    setIsLoading(false)
  }
}
