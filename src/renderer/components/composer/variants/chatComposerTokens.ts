import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { ComposerDraftToken } from '../tokens'
import { composerFileTokenId } from './shared/composerTokens'

export { fileToComposerToken, getComposerTokenIds, hasComposerToken } from './shared/composerTokens'

export const chatComposerTokenId = {
  file: composerFileTokenId,
  knowledge: (base: Pick<KnowledgeBase, 'id'>) => `knowledge:${base.id}`
}

export function knowledgeBaseToComposerToken(base: KnowledgeBase): ComposerDraftToken {
  return {
    id: chatComposerTokenId.knowledge(base),
    kind: 'knowledge',
    label: base.name,
    payload: base
  }
}
