import type { FileMetadata } from '@renderer/types'
import {
  composerFileTokenIdFromSourceId,
  getComposerFileTokenSourceId,
  withComposerFileTokenSourceId
} from '@renderer/utils/messageUtils/composerFileTokenSource'

import type { ComposerDraftToken, ComposerSerializedToken } from '../../tokens'

export const composerFileTokenId = (file: Pick<FileMetadata, 'fileTokenSourceId'>) => {
  const sourceId = getComposerFileTokenSourceId(file)
  if (!sourceId) {
    throw new Error('fileTokenSourceId is required to create a composer file token id')
  }
  return composerFileTokenIdFromSourceId(sourceId)
}

export function fileToComposerToken(file: FileMetadata): ComposerDraftToken {
  const sourceFile = withComposerFileTokenSourceId(file)
  return {
    id: composerFileTokenId(sourceFile),
    kind: 'file',
    label: sourceFile.origin_name || sourceFile.name,
    payload: sourceFile
  }
}

export function getComposerTokenIds(tokens: readonly ComposerSerializedToken[], kind?: ComposerDraftToken['kind']) {
  return new Set(tokens.filter((token) => !kind || token.kind === kind).map((token) => token.id))
}

export function hasComposerToken(tokens: readonly ComposerSerializedToken[], id: string) {
  return tokens.some((token) => token.id === id)
}
