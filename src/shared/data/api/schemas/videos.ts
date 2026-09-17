import * as z from 'zod'

import type { Video } from '@shared/data/types/video'

export const VIDEO_DEFAULT_LIMIT = 20
export const VIDEO_MAX_LIMIT = 100

export const ListVideosQuerySchema = z
  .object({
    providerId: z.string().trim().min(1).optional(),
    status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
    cursor: z.string().optional(),
    limit: z.int().positive().max(VIDEO_MAX_LIMIT).default(VIDEO_DEFAULT_LIMIT)
  })
  .strict()
export type ListVideosQueryParams = z.input<typeof ListVideosQuerySchema>
export type ListVideosQuery = z.output<typeof ListVideosQuerySchema>

export interface VideoListResponse {
  items: Video[]
  total: number
  nextCursor?: string
}

export type VideosSchemas = {
  '/videos': {
    GET: {
      query?: ListVideosQueryParams
      response: VideoListResponse
    }
  }
  '/videos/:id': {
    GET: {
      params: { id: string }
      response: Video
    }
    DELETE: {
      params: { id: string }
      response: void
    }
  }
}
