import type { AgentComposerLaunchOptions } from '@renderer/components/composer/variants/AgentComposer'
import { agentSkillToComposerToken } from '@renderer/components/composer/variants/agentComposerTokens'
import type { LocalSkill } from '@shared/types/skill'

const FEEDBACK_SKILL = { name: 'issue-reporter', filename: 'issue-reporter' } satisfies LocalSkill
const FEEDBACK_DRAFT_TEXT = 'Use the issue-reporter skill.'
export const FEEDBACK_INTENT_GUARD_TTL_MS = 5 * 60 * 1000

export type FeedbackComposerLaunch = Omit<AgentComposerLaunchOptions, 'onSent'> & { sessionId: string }

export function getFeedbackIntentGuardCacheKey(tabId: string): string {
  return `agent-feedback-intent-${tabId}`
}

function createFeedbackComposerDraft(): AgentComposerLaunchOptions['initialDraft'] {
  const skillToken = agentSkillToComposerToken(FEEDBACK_SKILL)
  return {
    text: FEEDBACK_DRAFT_TEXT,
    tokens: [{ ...skillToken, index: 0, textOffset: 0 }]
  }
}

export function createFeedbackComposerLaunch(sessionId: string): FeedbackComposerLaunch {
  return {
    sessionId,
    initialDraft: createFeedbackComposerDraft()
  }
}
