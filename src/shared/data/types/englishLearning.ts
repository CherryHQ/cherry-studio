import * as z from 'zod'

export const LearningSourceKindSchema = z.enum(['translation', 'selection_refine', 'selection_action'])
export type LearningSourceKind = z.infer<typeof LearningSourceKindSchema>

export const LearningSourceStatusSchema = z.enum(['pending', 'processing', 'ready', 'failed', 'excluded'])
export type LearningSourceStatus = z.infer<typeof LearningSourceStatusSchema>

export const LearningUnitKindSchema = z.enum(['expression', 'sentence', 'correction', 'pattern'])
export type LearningUnitKind = z.infer<typeof LearningUnitKindSchema>

export const LearningDedupDecisionSchema = z.enum(['same', 'related', 'distinct'])
export type LearningDedupDecision = z.infer<typeof LearningDedupDecisionSchema>

export const ReviewCardDirectionSchema = z.enum(['recognition', 'production', 'listening'])
export type ReviewCardDirection = z.infer<typeof ReviewCardDirectionSchema>

export const ReviewRatingSchema = z.enum(['again', 'hard', 'good', 'easy'])
export type ReviewRating = z.infer<typeof ReviewRatingSchema>

export const ReviewStatePhaseSchema = z.enum(['new', 'learning', 'review', 'relearning'])
export type ReviewStatePhase = z.infer<typeof ReviewStatePhaseSchema>

export const PracticeModeSchema = z.enum(['scenario', 'shadowing', 'spoken_recall'])
export type PracticeMode = z.infer<typeof PracticeModeSchema>

export const PracticeSessionStatusSchema = z.enum(['active', 'completed', 'interrupted', 'failed'])
export type PracticeSessionStatus = z.infer<typeof PracticeSessionStatusSchema>

export const LearningSyncTargetSchema = z.enum(['obsidian'])
export type LearningSyncTarget = z.infer<typeof LearningSyncTargetSchema>

export const LearningSyncStateSchema = z.enum(['pending', 'synced', 'conflict', 'failed'])
export type LearningSyncState = z.infer<typeof LearningSyncStateSchema>

export const LearningSourceSchema = z.strictObject({
  id: z.uuidv7(),
  kind: LearningSourceKindSchema,
  sourceRecordId: z.string().min(1),
  sourceRevision: z.string().min(1),
  status: LearningSourceStatusSchema,
  sourceLanguage: z.string().nullable(),
  targetLanguage: z.string().nullable(),
  sourceText: z.string().min(1),
  targetText: z.string().min(1),
  error: z.string().nullable(),
  processedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type LearningSource = z.infer<typeof LearningSourceSchema>

export const LearningUnitSchema = z.strictObject({
  id: z.uuidv7(),
  kind: LearningUnitKindSchema,
  english: z.string().min(1),
  normalizedEnglish: z.string().min(1),
  meaning: z.string().min(1),
  usageNote: z.string().nullable(),
  example: z.string().nullable(),
  tags: z.array(z.string()),
  cefr: z.string().nullable(),
  exactHash: z.string().min(1),
  extractionConfidence: z.number().min(0).max(1).nullable(),
  isUserEdited: z.boolean(),
  suspended: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type LearningUnit = z.infer<typeof LearningUnitSchema>

export interface SerializedReviewState {
  dueAt: string
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
  learningSteps: number
  phase: ReviewStatePhase
  lastReviewAt: string | null
  schedulerVersion: string
  suspended: boolean
}

export interface ReviewStateSnapshot {
  cardId: string
  state: SerializedReviewState
}

export interface DailyReviewCard {
  cardId: string
  direction: ReviewCardDirection
  unit: LearningUnit
  state: SerializedReviewState
}

export interface DailyReviewQueue {
  items: DailyReviewCard[]
  dueTotal: number
  newTotal: number
  estimatedMinutes: number
}

export interface ReviewSubmissionResult {
  eventId: string
  cardId: string
  rating: ReviewRating
  reviewedAt: string
  state: SerializedReviewState
}

export interface PracticeFeedback {
  transcript?: string
  correctedText?: string
  feedback?: string[]
  recognitionConfidence?: number
  textSimilarity?: number
}

export interface PracticeSession {
  id: string
  mode: PracticeMode
  status: PracticeSessionStatus
  scenario: string | null
  modelId: string | null
  providerId: string | null
  startedAt: string
  completedAt: string | null
  durationMs: number
  error: string | null
}

export interface PracticeAttempt {
  id: string
  practiceSessionId: string
  learningUnitId: string | null
  prompt: string
  transcript: string | null
  responseText: string | null
  feedback: PracticeFeedback
  recognitionConfidence: number | null
  textSimilarity: number | null
  durationMs: number
  attemptedAt: string
}
