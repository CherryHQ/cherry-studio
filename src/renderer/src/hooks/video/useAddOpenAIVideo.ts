import type OpenAI from '@cherrystudio/openai'
import { useCallback } from 'react'

import { useProviderVideos } from './useProviderVideos'

export const useAddOpenAIVideo = (providerId: string) => {
  const { addVideo } = useProviderVideos(providerId)

  const addOpenAIVideo = useCallback(
    (video: OpenAI.Videos.Video, prompt: string) => {
      switch (video.status) {
        case 'queued':
          addVideo({
            id: video.id,
            name: video.id,
            providerId,
            status: video.status,
            type: 'openai',
            metadata: video,
            prompt
          })
          break
        case 'in_progress':
          addVideo({
            id: video.id,
            name: video.id,
            providerId,
            status: 'in_progress',
            type: 'openai',
            progress: video.progress,
            metadata: video,
            prompt
          })
          break
        case 'completed':
          addVideo({
            id: video.id,
            name: video.id,
            providerId,
            status: 'completed',
            type: 'openai',
            metadata: video,
            prompt,
            thumbnail: null
          })
          break
        case 'failed':
          addVideo({
            id: video.id,
            name: video.id,
            providerId,
            status: 'failed',
            type: 'openai',
            error: video.error,
            metadata: video,
            prompt
          })
          break
      }
    },
    [addVideo, providerId]
  )

  return addOpenAIVideo
}
