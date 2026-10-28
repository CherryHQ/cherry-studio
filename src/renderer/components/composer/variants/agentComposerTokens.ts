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
    // The runtime lists and resolves skills by directory name, never by the SKILL.md / library
    // display name — naming the latter makes the agent report the skill as missing on first call.
    promptText: `Use the ${skill.filename} skill.`,
    payload: skill
  }
}
