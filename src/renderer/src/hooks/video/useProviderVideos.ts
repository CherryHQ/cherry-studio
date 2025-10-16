import { loggerService } from '@logger'
import { retrieveVideo } from '@renderer/services/ApiService'
import { getProviderById } from '@renderer/services/ProviderService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addVideoAction, setVideoAction, setVideosAction, updateVideoAction } from '@renderer/store/video'
import type { Video } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useVideos } from './useVideos'
import { useVideoThumbnail } from './useVideoThumbnail'

const logger = loggerService.withContext('useVideo')

export const useProviderVideos = (providerId: string) => {
  const { removeVideo } = useVideos()
  const videos = useAppSelector((state) => state.video.videoMap[providerId])
  const videosRef = useRef(videos)
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  useEffect(() => {
    videosRef.current = videos
  }, [videos])

  const getVideo = useCallback(
    (id: string) => {
      return videos?.find((v) => v.id === id)
    },
    [videos]
  )

  const addVideo = useCallback(
    (video: Video) => {
      if (videos && videos.every((v) => v.id !== video.id)) {
        dispatch(addVideoAction({ providerId, video }))
      }
    },
    [dispatch, providerId, videos]
  )

  const updateVideo = useCallback(
    (update: Partial<Omit<Video, 'status'>> & { id: string }) => {
      dispatch(updateVideoAction({ providerId, update }))
    },
    [dispatch, providerId]
  )

  const setVideo = useCallback(
    (video: Video) => {
      dispatch(setVideoAction({ providerId, video }))
    },
    [dispatch, providerId]
  )

  const setVideos = useCallback(
    (newVideos: Video[]) => {
      dispatch(setVideosAction({ providerId, videos: newVideos }))
    },
    [dispatch, providerId]
  )

  const removeProviderVideo = useCallback(
    (videoId: string) => {
      removeVideo(videoId, providerId)
    },
    [providerId, removeVideo]
  )

  useEffect(() => {
    if (!videos) {
      setVideos([])
    }
  }, [setVideos, videos])

  // update videos from api
  // NOTE: This provider should support openai videos endpoint. No runtime check here.
  const provider = getProviderById(providerId)
  const fetcher = async () => {
    if (!videos || !provider) return []
    if (provider.type === 'openai-response') {
      const openaiVideos = videos
        .filter((v) => v.type === 'openai')
        .filter((v) => v.status === 'queued' || v.status === 'in_progress')
      const jobs = openaiVideos.map((v) => retrieveVideo({ type: 'openai', videoId: v.id, provider }))
      const result = await Promise.allSettled(jobs)
      return result.filter((p) => p.status === 'fulfilled').map((p) => p.value)
    } else {
      throw new Error(`Provider type ${provider.type} is not supported for video status polling`)
    }
  }
  const { data, error } = useSWR('video/openai/videos', fetcher, { refreshInterval: 3000 })
  const { retrieveThumbnail, isRetrieving } = useVideoThumbnail()
  useEffect(() => {
    if (error) {
      logger.error('Failed to fetch video status updates', error)
      return
    }
    if (!provider) {
      logger.warn(`Provider ${providerId} not found.`)
      return
    }
    const videos = videosRef.current

    if (!data || !videos) return
    data.forEach((v) => {
      const retrievedVideo = v.video
      const storeVideo = videos.find((v) => v.id === retrievedVideo.id)
      if (!storeVideo) {
        logger.warn(`Try to update video ${retrievedVideo.id}, but it's not in the store.`)
        return
      }
      switch (retrievedVideo.status) {
        case 'in_progress':
          if (storeVideo.status === 'queued' || storeVideo.status === 'in_progress') {
            setVideo({
              ...storeVideo,
              status: 'in_progress',
              progress: retrievedVideo.progress,
              metadata: retrievedVideo
            })
          }
          break
        case 'completed': {
          if (storeVideo.status === 'in_progress' || storeVideo.status === 'queued') {
            const newVideo = { ...storeVideo, status: 'completed', thumbnail: null, metadata: retrievedVideo } as const
            setVideo(newVideo)
            // Try to get thumbnail
            if (isRetrieving(storeVideo.id)) return
            retrieveThumbnail(newVideo)
              .then((thumbnail) => {
                const latestVideo = videosRef.current?.find((v) => v.id === newVideo.id)
                if (
                  thumbnail !== null &&
                  latestVideo &&
                  latestVideo.status !== 'queued' &&
                  latestVideo.status !== 'in_progress' &&
                  latestVideo.status !== 'failed'
                ) {
                  setVideo({
                    ...latestVideo,
                    thumbnail
                  })
                }
              })
              .catch((e) => {
                logger.error('Failed to get thumbnail', e as Error)
                window.toast.error({ title: t('video.thumbnail.error.get'), description: getErrorMessage(e) })
              })
          }
          break
        }
        case 'failed':
          setVideo({
            ...storeVideo,
            status: 'failed',
            error: retrievedVideo.error,
            metadata: retrievedVideo
          })
      }
    })
  }, [data, error, provider, providerId, retrieveThumbnail, setVideo, t])

  return {
    videos: videos ?? [],
    getVideo,
    addVideo,
    updateVideo,
    setVideos,
    setVideo,
    removeVideo: removeProviderVideo
  }
}
