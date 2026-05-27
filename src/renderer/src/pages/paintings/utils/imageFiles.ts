import { loggerService } from '@logger'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import type { TFunction } from 'i18next'

import type { PaintingGenerationResult } from '../providers/types'

const logger = loggerService.withContext('PaintingImageFiles')

type DownloadPaintingUrlsOptions = {
  t?: TFunction
  forceDownload?: boolean
  saveDataImage?: boolean
  emptyUrlLogMessage?: string
  errorLogMessage?: string
  emptyUrlMessage?: string
}

type SaveGeneratedPaintingFilesOptions = DownloadPaintingUrlsOptions & {
  urls?: string[]
  base64s?: string[]
}

type SavePaintingGenerationResultOptions = DownloadPaintingUrlsOptions & {
  preferredResult?: 'base64s' | 'urls'
}

const getEmptyUrlMessage = (options: DownloadPaintingUrlsOptions) =>
  options.emptyUrlMessage ?? options.t?.('message.empty_url') ?? 'message.empty_url'

const shouldWarnEmptyUrl = (error: unknown) =>
  error instanceof Error && (error.message.includes('Failed to parse URL') || error.message.includes('Invalid URL'))

export function compactPaintingFiles(files: Array<FileMetadata | null | undefined>): FileMetadata[] {
  return files.filter((file): file is FileMetadata => file !== null && file !== undefined)
}

export async function downloadPaintingUrls(
  urls: string[],
  options: DownloadPaintingUrlsOptions = {}
): Promise<FileMetadata[]> {
  const downloadedFiles = await Promise.all(
    urls.map(async (url) => {
      try {
        if (!url?.trim()) {
          logger.error(options.emptyUrlLogMessage ?? 'Image URL is empty')
          window.toast.warning(getEmptyUrlMessage(options))
          return null
        }

        if (options.saveDataImage && url.startsWith('data:image')) {
          return await window.api.file.saveBase64Image(url)
        }

        if (options.forceDownload === undefined) {
          return await window.api.file.download(url)
        }

        return await window.api.file.download(url, options.forceDownload)
      } catch (error) {
        logger.error(options.errorLogMessage ?? 'Failed to download image', error as Error)

        if (shouldWarnEmptyUrl(error)) {
          window.toast.warning(getEmptyUrlMessage(options))
        }

        return null
      }
    })
  )

  return compactPaintingFiles(downloadedFiles)
}

export async function savePaintingBase64Images(base64s: string[]): Promise<FileMetadata[]> {
  const savedFiles = await Promise.all(
    base64s.map(async (base64) => {
      try {
        return await window.api.file.saveBase64Image(base64)
      } catch (error) {
        logger.error('Failed to save base64 image', error as Error)
        return null
      }
    })
  )

  return compactPaintingFiles(savedFiles)
}

export async function saveGeneratedPaintingFiles(options: SaveGeneratedPaintingFilesOptions): Promise<FileMetadata[]> {
  const files = [
    ...(options.urls?.length ? await downloadPaintingUrls(options.urls, options) : []),
    ...(options.base64s?.length ? await savePaintingBase64Images(options.base64s) : [])
  ]

  if (files.length > 0) {
    await FileManager.addFiles(files)
  }

  return files
}

export async function savePaintingGenerationResult(
  result: PaintingGenerationResult,
  options: SavePaintingGenerationResultOptions = {}
): Promise<{ files: FileMetadata[]; urls: string[] } | null> {
  let urlFiles: FileMetadata[] = []
  let base64Files: FileMetadata[] = []

  if (options.preferredResult === 'urls') {
    if (result.base64s.length > 0) {
      base64Files = await saveGeneratedPaintingFiles({ base64s: result.base64s })
    }

    if (result.urls.length > 0) {
      urlFiles = await saveGeneratedPaintingFiles({ urls: result.urls, ...options })
      return { files: urlFiles, urls: result.urls }
    }

    if (result.base64s.length > 0) {
      return { files: base64Files, urls: [] }
    }

    return null
  }

  if (result.urls.length > 0) {
    urlFiles = await saveGeneratedPaintingFiles({ urls: result.urls, ...options })
  }

  if (result.base64s.length > 0) {
    base64Files = await saveGeneratedPaintingFiles({ base64s: result.base64s })
    return { files: base64Files, urls: [] }
  }

  if (urlFiles.length > 0 || result.urls.length > 0) {
    return { files: urlFiles, urls: result.urls }
  }

  return null
}
