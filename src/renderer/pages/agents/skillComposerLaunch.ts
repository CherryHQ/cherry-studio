import type { AgentComposerLaunchOptions } from '@renderer/components/composer/variants/AgentComposer'
import { agentSkillToComposerToken } from '@renderer/components/composer/variants/agentComposerTokens'
import type { InstalledSkill } from '@shared/data/types/agent'

export const SKILL_INTENT_GUARD_TTL_MS = 5 * 60 * 1000

export type SkillComposerLaunch = Omit<AgentComposerLaunchOptions, 'onSent'> & { sessionId: string }

export function getSkillIntentGuardCacheKey(tabId: string): string {
  return `agent-skill-intent-${tabId}`
}

export function createSkillComposerLaunch(
  sessionId: string,
  skill: InstalledSkill,
  draftText: string
): SkillComposerLaunch {
  const skillToken = agentSkillToComposerToken({
    name: skill.name,
    filename: skill.folderName,
    description: skill.description ?? undefined
  })
  return {
    sessionId,
    initialDraft: {
      text: draftText,
      tokens: [{ ...skillToken, index: 0, textOffset: 0 }]
    }
  }
}
