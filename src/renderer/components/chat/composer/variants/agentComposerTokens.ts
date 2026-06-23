import type { LocalSkill } from '@renderer/types'

import type { ComposerDraftToken } from '../tokens'
import { composerFileTokenId, fileToComposerToken, getComposerTokenIds } from './shared/composerTokens'

export const agentFileToComposerToken = fileToComposerToken
export const getAgentComposerTokenIds = getComposerTokenIds

export const agentComposerTokenId = {
  file: composerFileTokenId,
  skill: (skill: Pick<LocalSkill, 'filename'>) => `skill:${skill.filename}`
}

export function agentSkillToComposerToken(skill: LocalSkill): ComposerDraftToken {
  return {
    id: agentComposerTokenId.skill(skill),
    kind: 'skill',
    label: skill.name,
    ...(skill.description && { description: skill.description }),
    promptText: `Use the ${skill.name} skill.`,
    payload: skill
  }
}
