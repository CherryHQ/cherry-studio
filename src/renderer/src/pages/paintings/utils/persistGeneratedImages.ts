import { loggerService } from '@logger'
import type { FileMetadata } from '@renderer/types'
import i18n from 'i18next'

export interface GeneratedImagePayload {
  kind: 'base64'
  data: string
  mediaType?: string
}

const logger = loggerService.withContext('persistGeneratedImages')

// TODO: in v2, should use new file service
export async function persistGeneratedImages(images: GeneratedImagePayload[]): Promise<FileMetadata[]> {
  const persistedFiles = await Promise.all(
    images.map(async (image) => {
      try {
        if (!image.data?.trim()) {
          logger.error('Generated image base64 payload is empty')
          window.toast.warning(i18n.t('message.empty_url'))
          return null
        }

        return await window.api.file.saveBase64Image(image.data)
      } catch (error) {
        logger.error('Failed to persist generated image', error as Error)
        return null
      }
    })
  )

  return persistedFiles.filter((file): file is FileMetadata => file !== null)
}
