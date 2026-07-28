import type { ReviewRating, SerializedReviewState } from '@shared/data/types/englishLearning'
import { type Card, type CardInput, createEmptyCard, fsrs, type Grade, Rating, State } from 'ts-fsrs'

export const REVIEW_SCHEDULER_VERSION = 'ts-fsrs@5.4.1'

const scheduler = fsrs()

const ratingMap: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy
}

const phaseToState = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning
} as const

const stateToPhase = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning'
} as const

function toSerializedState(card: Card, suspended: boolean): SerializedReviewState {
  return {
    dueAt: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learningSteps: card.learning_steps,
    phase: stateToPhase[card.state],
    lastReviewAt: card.last_review?.toISOString() ?? null,
    schedulerVersion: REVIEW_SCHEDULER_VERSION,
    suspended
  }
}

function toFsrsCard(state: SerializedReviewState): CardInput {
  return {
    due: state.dueAt,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsedDays,
    scheduled_days: state.scheduledDays,
    reps: state.reps,
    lapses: state.lapses,
    learning_steps: state.learningSteps,
    state: phaseToState[state.phase],
    last_review: state.lastReviewAt
  }
}

export function createInitialReviewState(now = new Date()): SerializedReviewState {
  return toSerializedState(createEmptyCard(now), false)
}

export function applyReviewRating(
  state: SerializedReviewState,
  rating: ReviewRating,
  reviewedAt = new Date()
): SerializedReviewState {
  const result = scheduler.next(toFsrsCard(state), reviewedAt, ratingMap[rating])
  return toSerializedState(result.card, state.suspended)
}
