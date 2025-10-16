import { loggerService } from '@logger'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import type { Video } from '@renderer/types'

const logger = loggerService.withContext('Store:video')

export interface VideoState {
  /** Provider ID to videos */
  videoMap: Record<string, Video[] | undefined>
}

const initialState: VideoState = {
  videoMap: {}
}

const videoSlice = createSlice({
  name: 'video',
  initialState,
  reducers: {
    addVideo: (state: VideoState, action: PayloadAction<{ providerId: string; video: Video }>) => {
      const { providerId, video } = action.payload
      if (state.videoMap[providerId]) {
        state.videoMap[providerId].unshift(video)
      } else {
        state.videoMap[providerId] = [video]
      }
    },
    removeVideo: (state: VideoState, action: PayloadAction<{ providerId: string; videoId: string }>) => {
      const { providerId, videoId } = action.payload
      const videos = state.videoMap[providerId]
      state.videoMap[providerId] = videos?.filter((c) => c.id !== videoId)
    },
    updateVideo: (
      state: VideoState,
      action: PayloadAction<{ providerId: string; update: Partial<Omit<Video, 'status'>> & { id: string } }>
    ) => {
      const { providerId, update } = action.payload
      const videos = state.videoMap[providerId]
      if (videos) {
        let video = videos.find((v) => v.id === update.id)
        if (video) {
          switch (video.status) {
            case 'queued':
            case 'in_progress':
              video = { ...video, ...update, thumbnail: undefined }
              break
            default:
              video = { ...video, ...update }
          }
        } else {
          logger.error(`Video with id ${update.id} not found in ${providerId}`)
        }
      } else {
        logger.error(`Videos with Provider ${providerId} is undefined.`)
      }
    },
    setVideo: (state: VideoState, action: PayloadAction<{ providerId: string; video: Video }>) => {
      const { providerId, video } = action.payload
      if (state.videoMap[providerId]) {
        const index = state.videoMap[providerId].findIndex((v) => v.id === video.id)
        if (index !== -1) {
          state.videoMap[providerId][index] = video
        } else {
          state.videoMap[providerId].push(video)
        }
      } else {
        state.videoMap[providerId] = [video]
      }
    },
    setVideos: (state: VideoState, action: PayloadAction<{ providerId: string; videos: Video[] }>) => {
      const { providerId, videos } = action.payload
      state.videoMap[providerId] = videos
    }
  }
})

export const {
  addVideo: addVideoAction,
  removeVideo: removeVideoAction,
  updateVideo: updateVideoAction,
  setVideo: setVideoAction,
  setVideos: setVideosAction
} = videoSlice.actions

export default videoSlice.reducer
