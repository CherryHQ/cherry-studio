import * as z from 'zod'

import {
  type DailyReviewQueue,
  type LearningSource,
  LearningSourceKindSchema,
  LearningSourceStatusSchema,
  type LearningUnit,
  LearningUnitKindSchema,
  LearningUnitSchema,
  ReviewRatingSchema,
  type ReviewSubmissionResult
} from '../../types/englishLearning'
import type { CursorPaginationParams, CursorPaginationResponse } from '../types'

export const ENGLISH_LEARNING_DEFAULT_LIMIT = 30
export const ENGLISH_LEARNING_MAX_LIMIT = 100
export const ENGLISH_LEARNING_SEARCH_MAX_LENGTH = 200

const CursorListQuerySchema = z.strictObject({
  cursor: z.string().optional(),
  limit: z.int().positive().max(ENGLISH_LEARNING_MAX_LIMIT).default(ENGLISH_LEARNING_DEFAULT_LIMIT)
})

export const LearningSourceListQuerySchema = CursorListQuerySchema.extend({
  kind: LearningSourceKindSchema.optional(),
  status: LearningSourceStatusSchema.optional()
})
export type LearningSourceListQuery = z.infer<typeof LearningSourceListQuerySchema>
export type LearningSourceListQueryParams = z.input<typeof LearningSourceListQuerySchema> & CursorPaginationParams

export interface LearningSourceListResponse extends CursorPaginationResponse<LearningSource> {
  items: LearningSource[]
  total: number
}

export const LearningUnitListQuerySchema = CursorListQuerySchema.extend({
  kind: LearningUnitKindSchema.optional(),
  suspended: z.boolean().optional(),
  search: z.string().trim().min(1).max(ENGLISH_LEARNING_SEARCH_MAX_LENGTH).optional()
})
export type LearningUnitListQuery = z.infer<typeof LearningUnitListQuerySchema>
export type LearningUnitListQueryParams = z.input<typeof LearningUnitListQuerySchema> & CursorPaginationParams

export interface LearningUnitListResponse extends CursorPaginationResponse<LearningUnit> {
  items: LearningUnit[]
  total: number
}

export const UpdateLearningUnitSchema = LearningUnitSchema.pick({
  kind: true,
  english: true,
  meaning: true,
  usageNote: true,
  example: true,
  tags: true,
  cefr: true,
  suspended: true
})
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one learning unit field is required' })
export type UpdateLearningUnitDto = z.infer<typeof UpdateLearningUnitSchema>

export const DailyReviewQueueQuerySchema = z.strictObject({
  limit: z.coerce.number().int().positive().max(100).default(50)
})
export type DailyReviewQueueQuery = z.infer<typeof DailyReviewQueueQuerySchema>

export const SubmitReviewSchema = z.strictObject({
  cardId: z.uuidv7(),
  rating: ReviewRatingSchema,
  durationMs: z
    .int()
    .nonnegative()
    .max(60 * 60 * 1_000),
  clientMutationId: z.string().trim().min(1).max(200)
})
export type SubmitReviewDto = z.infer<typeof SubmitReviewSchema>

export interface EnglishLearningDashboard {
  sources: Record<z.infer<typeof LearningSourceStatusSchema>, number>
  unitTotal: number
  suspendedUnitTotal: number
  dueNowTotal: number
  reviewedTodayTotal: number
  practiceMinutesToday: number
}

export type EnglishLearningSchemas = {
  '/english-learning/dashboard': {
    GET: {
      response: EnglishLearningDashboard
    }
  }
  '/english-learning/sources': {
    GET: {
      query?: LearningSourceListQueryParams
      response: LearningSourceListResponse
    }
  }
  '/english-learning/sources/:id': {
    GET: {
      params: { id: string }
      response: LearningSource
    }
  }
  '/english-learning/sources/:id/retry': {
    POST: {
      params: { id: string }
      response: LearningSource
    }
  }
  '/english-learning/sources/:id/exclude': {
    POST: {
      params: { id: string }
      response: LearningSource
    }
  }
  '/english-learning/units': {
    GET: {
      query?: LearningUnitListQueryParams
      response: LearningUnitListResponse
    }
  }
  '/english-learning/units/:id': {
    GET: {
      params: { id: string }
      response: LearningUnit
    }
    PATCH: {
      params: { id: string }
      body: UpdateLearningUnitDto
      response: LearningUnit
    }
  }
  '/english-learning/reviews/today': {
    GET: {
      query?: DailyReviewQueueQuery
      response: DailyReviewQueue
    }
  }
  '/english-learning/reviews/submit': {
    POST: {
      body: SubmitReviewDto
      response: ReviewSubmissionResult
    }
  }
}
