import type { LocalSkill } from '@shared/types/skill'

import type { ComposerDraftToken } from '../tokens'
import {
  composerFileTokenId,
  composerKnowledgeBaseTokenId,
  fileToComposerToken,
  getComposerTokenIds,
  knowledgeBaseToComposerToken
} from './shared/composerTokens'

export const agentFileToComposerToken = fileToComposerToken
export const agentKnowledgeBaseToComposerToken = knowledgeBaseToComposerToken
export const getAgentComposerTokenIds = getComposerTokenIds

export const agentComposerTokenId = {
  file: composerFileTokenId,
  knowledge: composerKnowledgeBaseTokenId,
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
