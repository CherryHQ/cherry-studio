import { videoService } from '@data/services/VideoService'
import { ListVideosQuerySchema } from '@shared/data/api/schemas/videos'
import type { VideosSchemas } from '@shared/data/api/schemas/videos'
import type { HandlersFor } from '@shared/data/api/types'

export const videoHandlers: HandlersFor<VideosSchemas> = {
  '/videos': {
    GET: async ({ query }) => {
      const parsed = ListVideosQuerySchema.parse(query ?? {})
      return videoService.list(parsed)
    }
  },

  '/videos/:id': {
    GET: async ({ params }) => {
      return videoService.getById(params.id)
    },
    DELETE: async ({ params }) => {
      videoService.delete(params.id)
      return undefined
    }
  }
}
