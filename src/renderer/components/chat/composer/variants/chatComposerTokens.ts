import type { FileMetadata } from '@renderer/types'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { ComposerDraftToken, ComposerSerializedToken } from '../tokens'

export const chatComposerTokenId = {
  file: (file: Pick<FileMetadata, 'id' | 'path'>) => `file:${file.id || file.path}`,
  knowledge: (base: Pick<KnowledgeBase, 'id'>) => `knowledge:${base.id}`
}

export function fileToComposerToken(file: FileMetadata): ComposerDraftToken {
  return {
    id: chatComposerTokenId.file(file),
    kind: 'file',
    label: file.origin_name || file.name,
    payload: file
  }
}

export function knowledgeBaseToComposerToken(base: KnowledgeBase): ComposerDraftToken {
  return {
    id: chatComposerTokenId.knowledge(base),
    kind: 'knowledge',
    label: base.name,
    payload: base
  }
}

export function getComposerTokenIds(tokens: readonly ComposerSerializedToken[], kind?: ComposerDraftToken['kind']) {
  return new Set(tokens.filter((token) => !kind || token.kind === kind).map((token) => token.id))
}

export function hasComposerToken(tokens: readonly ComposerSerializedToken[], id: string) {
  return tokens.some((token) => token.id === id)
}
