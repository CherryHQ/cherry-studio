import { useCallback } from 'react'

import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import type { ListVideosQueryParams } from '@shared/data/api/schemas/videos'
import type { UniqueModelId } from '@shared/data/types/model'

export function useVideos(query?: ListVideosQueryParams) {
  const { data, isLoading, refetch } = useQuery('/videos', query ? { query } : undefined)
  const { trigger: deleteTrigger } = useMutation('DELETE', '/videos/:id', { refresh: ['/videos'] })

  const deleteVideo = useCallback((id: string) => deleteTrigger({ params: { id } }), [deleteTrigger])

  return {
    videos: data?.items ?? [],
    total: data?.total ?? 0,
    isLoading,
    refresh: refetch,
    deleteVideo
  }
}

export function useGenerateVideo() {
  const generate = useCallback(
    (payload: { uniqueModelId: UniqueModelId; prompt: string; duration?: number; resolution?: string }) =>
      ipcApi.request('ai.video.generate', payload),
    []
  )
  return { generate }
}
