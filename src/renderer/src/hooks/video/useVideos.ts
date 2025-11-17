import FileManager from '@renderer/services/FileManager'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { removeVideoAction } from '@renderer/store/video'
import { objectValues } from '@renderer/types'
import { useCallback } from 'react'

import { useVideoThumbnail } from './useVideoThumbnail'

export const useVideos = () => {
  const videoMap = useAppSelector((state) => state.video.videoMap)
  const dispatch = useAppDispatch()

  const { removeThumbnail } = useVideoThumbnail()

  const videos = objectValues(videoMap)
    .flat()
    .filter((v) => v !== undefined)

  const getVideo = useCallback(
    (videoId: string) => {
      return videos.find((v) => v.id === videoId)
    },
    [videos]
  )

  const removeVideo = useCallback(
    (videoId: string, providerId?: string) => {
      const video = getVideo(videoId)
      if (!video) {
        return
      }
      if (!providerId) {
        providerId = video.providerId
      }
      // should delete from redux state, and related thumbnail image, video file
      if (video.thumbnail) {
        removeThumbnail(videoId)
      }
      if (video.fileId) {
        FileManager.deleteFile(video.fileId)
      }
      dispatch(removeVideoAction({ providerId, videoId }))
    },
    [dispatch, getVideo, removeThumbnail]
  )

  return { videos, getVideo, removeVideo }
}
