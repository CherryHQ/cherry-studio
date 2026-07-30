import * as z from 'zod'

import {
  type DailyReviewQueue,
  type LearningSource,
  LearningSourceKindSchema,
  LearningSourceStatusSchema,
  type LearningUnit,
  LearningUnitKindSchema,
  LearningUnitSchema,
  type PracticeAttempt,
  PracticeModeSchema,
  type PracticeSession,
  PracticeSessionStatusSchema,
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

export const CreatePracticeSessionSchema = z.strictObject({
  mode: PracticeModeSchema,
  scenario: z.string().trim().min(1).max(2_000).optional(),
  modelId: z.string().trim().min(1).max(500).optional(),
  providerId: z.string().trim().min(1).max(200).optional()
})
export type CreatePracticeSessionDto = z.infer<typeof CreatePracticeSessionSchema>

export const AddPracticeAttemptSchema = z.strictObject({
  learningUnitId: z.uuidv7().optional(),
  prompt: z.string().trim().min(1).max(8_000),
  transcript: z.string().trim().max(16_000).optional(),
  responseText: z.string().trim().max(16_000).optional(),
  feedback: z
    .strictObject({
      transcript: z.string().max(16_000).optional(),
      correctedText: z.string().max(16_000).optional(),
      feedback: z.array(z.string().max(2_000)).max(20).optional(),
      pronunciation: z
        .strictObject({
          source: z.enum(['audio', 'transcript_only']),
          pronunciation: z.string().max(2_000),
          stress: z.string().max(2_000),
          intonation: z.string().max(2_000),
          pace: z.string().max(2_000),
          wordLevelNotes: z
            .array(
              z.strictObject({
                word: z.string().max(200),
                issue: z.string().max(2_000),
                suggestion: z.string().max(2_000)
              })
            )
            .max(20)
        })
        .optional(),
      recognitionConfidence: z.number().min(0).max(1).optional(),
      textSimilarity: z.number().min(0).max(1).optional()
    })
    .default({}),
  recognitionConfidence: z.number().min(0).max(1).optional(),
  textSimilarity: z.number().min(0).max(1).optional(),
  durationMs: z
    .int()
    .nonnegative()
    .max(24 * 60 * 60 * 1_000)
    .default(0)
})
export type AddPracticeAttemptDto = z.infer<typeof AddPracticeAttemptSchema>

export const FinishPracticeSessionSchema = z.strictObject({
  status: PracticeSessionStatusSchema.exclude(['active']),
  error: z.string().trim().max(4_000).optional()
})
export type FinishPracticeSessionDto = z.infer<typeof FinishPracticeSessionSchema>

export const ImportSelectionActionResultSchema = z.strictObject({
  actionId: z.string().trim().min(1).max(128),
  actionName: z.string().trim().min(1).max(256).optional(),
  selectedText: z.string().trim().min(1).max(16_000),
  outputText: z.string().trim().min(1).max(16_000)
})
export type ImportSelectionActionResultDto = z.infer<typeof ImportSelectionActionResultSchema>

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
  '/english-learning/selection-actions/import': {
    POST: {
      body: ImportSelectionActionResultDto
      response: void
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
  '/english-learning/practice/sessions': {
    POST: {
      body: CreatePracticeSessionDto
      response: PracticeSession
    }
  }
  '/english-learning/practice/sessions/:id': {
    GET: {
      params: { id: string }
      response: PracticeSession
    }
    PATCH: {
      params: { id: string }
      body: FinishPracticeSessionDto
      response: PracticeSession
    }
  }
  '/english-learning/practice/sessions/:id/attempts': {
    POST: {
      params: { id: string }
      body: AddPracticeAttemptDto
      response: PracticeAttempt
    }
  }
}
