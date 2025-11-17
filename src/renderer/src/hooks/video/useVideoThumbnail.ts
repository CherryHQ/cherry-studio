import { loggerService } from '@logger'
import { retrieveVideoContent } from '@renderer/services/ApiService'
import ImageStorage from '@renderer/services/ImageStorage'
import { getProviderById } from '@renderer/services/ProviderService'
import type { Video } from '@renderer/types'
import { useCallback } from 'react'

const logger = loggerService.withContext('useRetrieveThumbnail')

const pendingSet = new Set<string>()

export const useVideoThumbnail = () => {
  const getThumbnailKey = useCallback((id: string) => {
    return `video-thumbnail-${id}`
  }, [])

  const isRetrieving = useCallback(
    (id: string) => {
      const key = getThumbnailKey(id)
      return pendingSet.has(key)
    },
    [getThumbnailKey]
  )

  const retrieveThumbnail = useCallback(
    async (video: Video): Promise<string> => {
      const provider = getProviderById(video.providerId)
      if (!provider) {
        throw new Error(`Provider not found for id ${video.providerId}`)
      }
      const thumbnailKey = getThumbnailKey(video.id)
      if (isRetrieving(video.id)) {
        throw new Error('Thumbnail retrieval already pending')
      }

      pendingSet.add(thumbnailKey)
      try {
        const cachedThumbnail = await ImageStorage.get(thumbnailKey)
        if (cachedThumbnail) {
          return cachedThumbnail
        }

        const result = await retrieveVideoContent({
          type: 'openai',
          provider,
          videoId: video.id,
          query: { variant: 'thumbnail' }
        })

        const { response } = result
        if (!response.ok) {
          throw new Error(`Unexpected thumbnail status: ${response.status}`)
        }

        const blob = await response.blob()
        if (!blob || blob.size === 0) {
          throw new Error('Thumbnail response body is empty')
        }

        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => {
            if (typeof reader.result === 'string') {
              resolve(reader.result)
            } else {
              reject(new Error('Failed to convert thumbnail to base64'))
            }
          }
          reader.onerror = () => reject(reader.error ?? new Error('Failed to read thumbnail blob'))
          reader.readAsDataURL(blob)
        })

        await ImageStorage.set(thumbnailKey, base64)
        return base64
      } catch (e) {
        logger.error(`Failed to get thumbnail for video ${video.id}`, e as Error)
        throw e
      } finally {
        pendingSet.delete(thumbnailKey)
      }
    },
    [getThumbnailKey]
  )

  const removeThumbnail = useCallback(
    async (id: string) => {
      const key = getThumbnailKey(id)
      return ImageStorage.remove(key)
    },
    [getThumbnailKey]
  )

  return { getThumbnailKey, retrieveThumbnail, removeThumbnail, isRetrieving }
}
