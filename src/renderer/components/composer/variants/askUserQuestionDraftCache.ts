import { cacheService } from '@data/CacheService'
import type { CacheAskUserQuestionDraft } from '@shared/data/cache/cacheValueTypes'

/**
 * Unsubmitted AskUserQuestion answers.
 *
 * The answers live in the override composer's local state, so any remount —
 * switching conversations and coming back, for example — used to discard them.
 * They are small and short-lived, so they are kept in the renderer memory cache
 * (the same tier as the composer drafts) keyed by approval id, and are dropped
 * when a persisted message records the answer or dismissal.
 */
const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000

export type AskUserQuestionDraftCache = CacheAskUserQuestionDraft

export type AskUserQuestionDraftCacheKey = `agent.ask_user_question_draft.${string}`

export const getAskUserQuestionDraftCacheKey = (approvalId: string): AskUserQuestionDraftCacheKey =>
  `agent.ask_user_question_draft.${approvalId}`

const EMPTY_DRAFT: AskUserQuestionDraftCache = {
  selectedAnswers: {},
  customAnswers: {},
  currentIndex: 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Question indices are stored as object keys, so they come back as strings. */
function parseQuestionIndex(key: string): number | null {
  const index = Number(key)
  return Number.isInteger(index) && index >= 0 ? index : null
}

export function readAskUserQuestionDraftCache(approvalId: string): AskUserQuestionDraftCache {
  const cached = cacheService.get(getAskUserQuestionDraftCacheKey(approvalId))
  if (!isRecord(cached)) return EMPTY_DRAFT

  const selectedAnswers: Record<number, string[]> = {}
  if (isRecord(cached.selectedAnswers)) {
    for (const [key, labels] of Object.entries(cached.selectedAnswers)) {
      const index = parseQuestionIndex(key)
      if (index === null || !Array.isArray(labels)) continue
      selectedAnswers[index] = labels.filter((label): label is string => typeof label === 'string')
    }
  }

  const customAnswers: Record<number, string> = {}
  if (isRecord(cached.customAnswers)) {
    for (const [key, text] of Object.entries(cached.customAnswers)) {
      const index = parseQuestionIndex(key)
      if (index === null || typeof text !== 'string') continue
      customAnswers[index] = text
    }
  }

  const cachedIndex = cached.currentIndex
  const currentIndex =
    typeof cachedIndex === 'number' && Number.isInteger(cachedIndex) && cachedIndex >= 0 ? cachedIndex : 0

  return { selectedAnswers, customAnswers, currentIndex }
}

export function writeAskUserQuestionDraftCache(approvalId: string, draft: AskUserQuestionDraftCache): void {
  cacheService.set(
    getAskUserQuestionDraftCacheKey(approvalId),
    {
      selectedAnswers: Object.fromEntries(
        Object.entries(draft.selectedAnswers).map(([index, labels]) => [index, [...labels]])
      ),
      customAnswers: { ...draft.customAnswers },
      currentIndex: draft.currentIndex
    },
    DRAFT_CACHE_TTL
  )
}

export function clearAskUserQuestionDraftCache(approvalId: string): void {
  cacheService.delete(getAskUserQuestionDraftCacheKey(approvalId))
}
