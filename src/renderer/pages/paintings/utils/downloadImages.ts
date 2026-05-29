import { loggerService } from '@logger'
import type { FileMetadata } from '@renderer/types'
import i18next from 'i18next'

import { fileEntryToMetadata } from './fileEntryAdapter'

const logger = loggerService.withContext('paintings/downloadImages')

export interface DownloadImagesOptions {
  allowBase64DataUrls?: boolean
  showProxyWarning?: boolean
}

export async function downloadImages(urls: string[], options?: DownloadImagesOptions): Promise<FileMetadata[]> {
  const { allowBase64DataUrls = false, showProxyWarning = false } = options ?? {}

  const downloadedFiles = await Promise.all(
    urls.map(async (url) => {
      try {
        if (!url?.trim()) {
          logger.error('Image URL is empty, possibly due to prohibited prompt')
          window.toast.warning(i18next.t('message.empty_url'))
          return null
        }
        const entry =
          allowBase64DataUrls && url.startsWith('data:image')
            ? await window.api.file.createInternalEntry({
                source: 'base64',
                data: url as `data:${string};base64,${string}`
              })
            : await window.api.file.createInternalEntry({
                source: 'url',
                url: url as `http://${string}` | `https://${string}`
              })
        return await fileEntryToMetadata(entry)
      } catch (error) {
        logger.error(`Failed to download image: ${error}`)
        if (
          error instanceof Error &&
          (error.message.includes('Failed to parse URL') || error.message.includes('Invalid URL'))
        ) {
          window.toast.warning(i18next.t('message.empty_url'))
        } else if (showProxyWarning) {
          window.toast.warning(i18next.t('paintings.proxy_required'))
        }
        return null
      }
    })
  )

  return downloadedFiles.filter((file): file is FileMetadata => file !== null)
}
