import { englishLearningDashboardService } from '@data/services/EnglishLearningDashboardService'
import { learningSourceService } from '@data/services/LearningSourceService'
import { learningUnitService } from '@data/services/LearningUnitService'
import { reviewService } from '@data/services/ReviewService'
import {
  DailyReviewQueueQuerySchema,
  type EnglishLearningSchemas,
  LearningSourceListQuerySchema,
  LearningUnitListQuerySchema,
  SubmitReviewSchema,
  UpdateLearningUnitSchema
} from '@shared/data/api/schemas/englishLearning'
import type { HandlersFor } from '@shared/data/api/types'

export const englishLearningHandlers: HandlersFor<EnglishLearningSchemas> = {
  '/english-learning/dashboard': {
    GET: async () => englishLearningDashboardService.get()
  },
  '/english-learning/sources': {
    GET: async ({ query }) => learningSourceService.list(LearningSourceListQuerySchema.parse(query ?? {}))
  },
  '/english-learning/sources/:id': {
    GET: async ({ params }) => learningSourceService.getById(params.id)
  },
  '/english-learning/sources/:id/retry': {
    POST: async ({ params }) => learningSourceService.retry(params.id)
  },
  '/english-learning/sources/:id/exclude': {
    POST: async ({ params }) => learningSourceService.exclude(params.id)
  },
  '/english-learning/units': {
    GET: async ({ query }) => learningUnitService.list(LearningUnitListQuerySchema.parse(query ?? {}))
  },
  '/english-learning/units/:id': {
    GET: async ({ params }) => learningUnitService.getById(params.id),
    PATCH: async ({ params, body }) => learningUnitService.update(params.id, UpdateLearningUnitSchema.parse(body))
  },
  '/english-learning/reviews/today': {
    GET: async ({ query }) => reviewService.getDailyQueue(DailyReviewQueueQuerySchema.parse(query ?? {}))
  },
  '/english-learning/reviews/submit': {
    POST: async ({ body }) => reviewService.submit(SubmitReviewSchema.parse(body))
  }
}
