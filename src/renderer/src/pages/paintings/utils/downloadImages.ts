import { loggerService } from '@logger'
import type { FileMetadata } from '@renderer/types'

const logger = loggerService.withContext('paintings/downloadImages')

export interface DownloadImagesOptions {
  allowBase64DataUrls?: boolean
  showProxyWarning?: boolean
}

export async function downloadImages(
  urls: string[],
  t: (key: string) => string,
  options?: DownloadImagesOptions
): Promise<FileMetadata[]> {
  const { allowBase64DataUrls = false, showProxyWarning = false } = options ?? {}

  const downloadedFiles = await Promise.all(
    urls.map(async (url) => {
      try {
        if (!url?.trim()) {
          logger.error('Image URL is empty, possibly due to prohibited prompt')
          window.toast.warning(t('message.empty_url'))
          return null
        }
        if (allowBase64DataUrls && url.startsWith('data:image')) {
          return await window.api.file.saveBase64Image(url)
        }
        return await window.api.file.download(url, allowBase64DataUrls)
      } catch (error) {
        logger.error(`Failed to download image: ${error}`)
        if (
          error instanceof Error &&
          (error.message.includes('Failed to parse URL') || error.message.includes('Invalid URL'))
        ) {
          window.toast.warning(t('message.empty_url'))
        } else if (showProxyWarning) {
          window.toast.warning(t('paintings.proxy_required'))
        }
        return null
      }
    })
  )

  return downloadedFiles.filter((file): file is FileMetadata => file !== null)
}
