/** Read-only DataApi handlers for internally captured AI usage records. */

import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import type { AiUsageRecordSchemas } from '@shared/data/api/schemas/aiUsageRecords'
import {
  AiUsageRecordListQuerySchema,
  AiUsageRecordStatsQuerySchema,
  AiUsageRecordTimelineQuerySchema
} from '@shared/data/api/schemas/aiUsageRecords'
import type { HandlersFor } from '@shared/data/api/types'

export const aiUsageRecordHandlers: HandlersFor<AiUsageRecordSchemas> = {
  '/ai-usage-records': {
    GET: async ({ query }) => {
      const parsed = AiUsageRecordListQuerySchema.parse(query ?? {})
      return aiUsageRecordService.list(parsed)
    }
  },

  '/ai-usage-records/stats': {
    GET: async ({ query }) => {
      const parsed = AiUsageRecordStatsQuerySchema.parse(query)
      return aiUsageRecordService.stats(parsed)
    }
  },

  '/ai-usage-records/timeline': {
    GET: async ({ query }) => {
      const parsed = AiUsageRecordTimelineQuerySchema.parse(query)
      return aiUsageRecordService.timeline(parsed)
    }
  }
}
