import type { FileMetadata, LocalSkill } from '@renderer/types'

import type { ComposerDraftToken, ComposerSerializedToken } from '../tokens'

export const agentComposerTokenId = {
  file: (file: Pick<FileMetadata, 'id' | 'path'>) => `file:${file.id || file.path}`,
  skill: (skill: Pick<LocalSkill, 'filename'>) => `skill:${skill.filename}`
}

export function agentFileToComposerToken(file: FileMetadata): ComposerDraftToken {
  return {
    id: agentComposerTokenId.file(file),
    kind: 'file',
    label: file.origin_name || file.name,
    payload: file
  }
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

export function getAgentComposerTokenIds(
  tokens: readonly ComposerSerializedToken[],
  kind?: ComposerDraftToken['kind']
) {
  return new Set(tokens.filter((token) => !kind || token.kind === kind).map((token) => token.id))
}
