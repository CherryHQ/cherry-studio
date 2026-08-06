import { cacheService } from '@data/CacheService'
import { writeAgentDraftCache } from '@renderer/components/composer/variants/agent/agentDraftCache'
import type { AgentComposerLaunchOptions } from '@renderer/components/composer/variants/AgentComposer'
import { agentSkillToComposerToken } from '@renderer/components/composer/variants/agentComposerTokens'
import type { LocalSkill } from '@shared/types/skill'

const FEEDBACK_SKILL = { name: 'issue-reporter', filename: 'issue-reporter' } satisfies LocalSkill
const FEEDBACK_DRAFT_TEXT = 'Use the issue-reporter skill.'
const FEEDBACK_LAUNCH_TTL_MS = 24 * 60 * 60 * 1000
export const FEEDBACK_INTENT_GUARD_TTL_MS = 5 * 60 * 1000

export type FeedbackComposerLaunch = Omit<AgentComposerLaunchOptions, 'onSent'> & { sessionId: string }

export function getFeedbackIntentGuardCacheKey(tabId: string): string {
  return `agent-feedback-intent-${tabId}`
}

function getFeedbackDraftCacheKey(sessionId: string) {
  return `agent.composer_draft.feedback_${sessionId}` as const
}

function getFeedbackLaunchCacheKey(sessionId: string): string {
  return `agent-feedback-launch-${sessionId}`
}

function createFeedbackComposerDraft(): AgentComposerLaunchOptions['initialDraft'] {
  const skillToken = agentSkillToComposerToken(FEEDBACK_SKILL)
  return {
    text: FEEDBACK_DRAFT_TEXT,
    tokens: [{ ...skillToken, index: 0, textOffset: 0 }]
  }
}

export function persistFeedbackComposerLaunch(sessionId: string): FeedbackComposerLaunch {
  const launch = {
    sessionId,
    draftCacheKey: getFeedbackDraftCacheKey(sessionId),
    initialDraft: createFeedbackComposerDraft()
  }
  writeAgentDraftCache(launch.draftCacheKey, {
    ...launch.initialDraft,
    files: [],
    knowledgeBaseIds: [],
    workspaceKey: '',
    agentId: ''
  })
  cacheService.setCasual(getFeedbackLaunchCacheKey(sessionId), launch, FEEDBACK_LAUNCH_TTL_MS)
  return launch
}

export function readFeedbackComposerLaunch(sessionId: string): FeedbackComposerLaunch | null {
  const launch = cacheService.getCasual<FeedbackComposerLaunch>(getFeedbackLaunchCacheKey(sessionId))
  return launch?.sessionId === sessionId ? launch : null
}

export function clearFeedbackComposerLaunch(launch: FeedbackComposerLaunch): void {
  cacheService.deleteCasual(getFeedbackLaunchCacheKey(launch.sessionId))
}
