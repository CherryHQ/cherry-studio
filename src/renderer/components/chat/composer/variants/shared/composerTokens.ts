import type { ComposerAttachment } from '@renderer/utils/messageUtils/composerAttachment'
import {
  composerFileTokenIdFromSourceId,
  getComposerFileTokenSourceId
} from '@renderer/utils/messageUtils/composerFileTokenSource'

import type { ComposerDraftToken, ComposerSerializedToken } from '../../tokens'

export const composerFileTokenId = (file: Pick<ComposerAttachment, 'fileTokenSourceId'>) => {
  const sourceId = getComposerFileTokenSourceId(file)
  if (!sourceId) {
    throw new Error('fileTokenSourceId is required to create a composer file token id')
  }
  return composerFileTokenIdFromSourceId(sourceId)
}

export function fileToComposerToken(file: ComposerAttachment): ComposerDraftToken {
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
