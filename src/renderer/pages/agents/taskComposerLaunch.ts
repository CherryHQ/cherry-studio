import type { AgentComposerLaunchOptions } from '@renderer/components/composer/variants/AgentComposer'

export const TASK_INTENT_GUARD_TTL_MS = 5 * 60 * 1000

export type TaskComposerLaunch = Omit<AgentComposerLaunchOptions, 'onSent'> & { sessionId: string }

export function getTaskIntentGuardCacheKey(tabId: string): string {
  return `agent-task-intent-${tabId}`
}

export function createTaskComposerLaunch(sessionId: string, draftText: string): TaskComposerLaunch {
  return { sessionId, initialDraft: { text: draftText, tokens: [] } }
}
