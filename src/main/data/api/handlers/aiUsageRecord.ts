/** Read-only DataApi handlers for internally captured AI usage records. */

import { aiUsageRecordService } from '@data/services/aiUsageRecord'
import type { AiUsageRecordSchemas } from '@shared/data/api/schemas/aiUsageRecord'
import {
  AiUsageRecordListQuerySchema,
  AiUsageRecordStatsQuerySchema,
  AiUsageRecordTimelineQuerySchema
} from '@shared/data/api/schemas/aiUsageRecord'
import type { HandlersFor } from '@shared/data/api/types'

export const aiUsageRecordHandlers: HandlersFor<AiUsageRecordSchemas> = {
  '/ai-usage-records': {
    GET: async ({ query }) => {
      const parsed = AiUsageRecordListQuerySchema.parse(query ?? {})
      return await aiUsageRecordService.list(parsed)
    }
  },

  '/ai-usage-records/stats': {
    GET: async ({ query }) => {
      const parsed = AiUsageRecordStatsQuerySchema.parse(query)
      return await aiUsageRecordService.stats(parsed)
    }
  },

  '/ai-usage-records/timeline': {
    GET: async ({ query }) => {
      const parsed = AiUsageRecordTimelineQuerySchema.parse(query)
      return await aiUsageRecordService.timeline(parsed)
    }
  }
}
