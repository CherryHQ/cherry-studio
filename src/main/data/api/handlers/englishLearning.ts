import { englishLearningDashboardService } from '@data/services/EnglishLearningDashboardService'
import { learningSourceService } from '@data/services/LearningSourceService'
import { learningUnitService } from '@data/services/LearningUnitService'
import { practiceService } from '@data/services/PracticeService'
import { reviewService } from '@data/services/ReviewService'
import {
  AddPracticeAttemptSchema,
  CreatePracticeSessionSchema,
  DailyReviewQueueQuerySchema,
  type EnglishLearningSchemas,
  FinishPracticeSessionSchema,
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
  },
  '/english-learning/practice/sessions': {
    POST: async ({ body }) => practiceService.create(CreatePracticeSessionSchema.parse(body))
  },
  '/english-learning/practice/sessions/:id': {
    GET: async ({ params }) => practiceService.getById(params.id),
    PATCH: async ({ params, body }) => practiceService.finish(params.id, FinishPracticeSessionSchema.parse(body))
  },
  '/english-learning/practice/sessions/:id/attempts': {
    POST: async ({ params, body }) => practiceService.addAttempt(params.id, AddPracticeAttemptSchema.parse(body))
  }
}
