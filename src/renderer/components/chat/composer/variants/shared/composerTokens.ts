import type { FileMetadata } from '@renderer/types'

import type { ComposerDraftToken, ComposerSerializedToken } from '../../tokens'

export const composerFileTokenId = (file: Pick<FileMetadata, 'id' | 'path'>) => `file:${file.id || file.path}`

export function fileToComposerToken(file: FileMetadata): ComposerDraftToken {
  return {
    id: composerFileTokenId(file),
    kind: 'file',
    label: file.origin_name || file.name,
    payload: file
  }
}

export function getComposerTokenIds(tokens: readonly ComposerSerializedToken[], kind?: ComposerDraftToken['kind']) {
  return new Set(tokens.filter((token) => !kind || token.kind === kind).map((token) => token.id))
}

export function hasComposerToken(tokens: readonly ComposerSerializedToken[], id: string) {
  return tokens.some((token) => token.id === id)
}
