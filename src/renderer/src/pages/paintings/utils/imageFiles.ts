import { loggerService } from '@logger'
import type { FileEntry } from '@shared/data/types/file'
import type { Base64String, FilePath, URLString } from '@shared/file/types'
import { toSafeFileUrl } from '@shared/file/urlUtil'
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

const isBase64DataUri = (value: string): value is Base64String =>
  value.startsWith('data:') && value.includes(';base64,')

const toBase64DataUri = (value: string): Base64String =>
  isBase64DataUri(value) ? value : `data:image/png;base64,${value}`

const toHttpUrl = (value: string): URLString => {
  if (!value.startsWith('http://') && !value.startsWith('https://')) {
    throw new Error('Invalid URL')
  }

  return value as URLString
}

export function compactPaintingFiles(files: Array<FileEntry | null | undefined>): FileEntry[] {
  return files.filter((file): file is FileEntry => file !== null && file !== undefined)
}

export async function downloadPaintingUrls(
  urls: string[],
  options: DownloadPaintingUrlsOptions = {}
): Promise<FileEntry[]> {
  const downloadedFiles = await Promise.all(
    urls.map(async (url) => {
      try {
        const imageUrl = url?.trim()

        if (!imageUrl) {
          logger.error(options.emptyUrlLogMessage ?? 'Image URL is empty')
          window.toast.warning(getEmptyUrlMessage(options))
          return null
        }

        if (imageUrl.startsWith('data:image')) {
          return await window.api.file.createInternalEntry({ source: 'base64', data: toBase64DataUri(imageUrl) })
        }

        return await window.api.file.createInternalEntry({ source: 'url', url: toHttpUrl(imageUrl) })
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

export async function savePaintingBase64Images(base64s: string[]): Promise<FileEntry[]> {
  const savedFiles = await Promise.all(
    base64s.map(async (base64) => {
      try {
        return await window.api.file.createInternalEntry({ source: 'base64', data: toBase64DataUri(base64) })
      } catch (error) {
        logger.error('Failed to save base64 image', error as Error)
        return null
      }
    })
  )

  return compactPaintingFiles(savedFiles)
}

export async function saveGeneratedPaintingFiles(options: SaveGeneratedPaintingFilesOptions): Promise<FileEntry[]> {
  return [
    ...(options.urls?.length ? await downloadPaintingUrls(options.urls, options) : []),
    ...(options.base64s?.length ? await savePaintingBase64Images(options.base64s) : [])
  ]
}

export async function savePaintingGenerationResult(
  result: PaintingGenerationResult,
  options: SavePaintingGenerationResultOptions = {}
): Promise<{ files: FileEntry[]; urls: string[] } | null> {
  let urlFiles: FileEntry[] = []
  let base64Files: FileEntry[] = []

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

export async function getPaintingFileUrl(file: Pick<FileEntry, 'id' | 'ext'>): Promise<string> {
  const physicalPath = await window.api.file.getPhysicalPath({ id: file.id })
  return toSafeFileUrl(physicalPath as FilePath, file.ext)
}

export async function fileEntryToImageFile(file: FileEntry, index: number): Promise<File> {
  const physicalPath = await window.api.file.getPhysicalPath({ id: file.id })
  const data = await window.api.fs.read(physicalPath)
  const ext = file.ext ? `.${file.ext}` : ''
  const fileName = `${file.name || `image_${index + 1}`}${ext}`
  const mime = file.ext ? `image/${file.ext === 'jpg' ? 'jpeg' : file.ext}` : 'image/png'

  return new File([data], fileName, {
    type: mime,
    lastModified: file.updatedAt
  })
}
