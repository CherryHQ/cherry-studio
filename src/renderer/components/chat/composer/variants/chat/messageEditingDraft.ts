import { FILE_TYPE } from '@renderer/types'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import {
  composerFileTokenIdFromSourceId,
  createComposerFileTokenSourceId,
  getComposerFileTokenSourceId,
  readComposerFileTokenIdSuffix
} from '@renderer/utils/message/composerFileTokenSource'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { CherryMessagePart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { getFileTypeByExt } from '@shared/utils/file/fileType'

import { type ComposerSerializedToken, isComposerDraftTokenKind } from '../../tokens'
import { chatComposerTokenId, getComposerTokenIds } from '../chatComposerTokens'

export interface EditableMessageDraft {
  text: string
  draftTokens: ComposerSerializedToken[]
  files: ComposerAttachment[]
}

function findEditableFileToken(
  part: Extract<CherryMessagePart, { type: 'file' }>,
  path: string,
  fileTokens: ComposerSerializedToken[],
  usedTokenIds: Set<string>
) {
  const cherry = readCherryMeta(part)
  const sourceIds = [cherry?.fileTokenSourceId, cherry?.fileEntryId, path].filter(
    (sourceId): sourceId is string => !!sourceId
  )
  const matchedToken = fileTokens.find(
    (token) =>
      !usedTokenIds.has(token.id) && sourceIds.some((sourceId) => readComposerFileTokenIdSuffix(token.id) === sourceId)
  )
  if (matchedToken) return matchedToken

  // Only fall back when exactly one file token remains unused — guessing among multiple unmatched
  // tokens could attach a part to the wrong token source id.
  const unusedTokens = fileTokens.filter((token) => !usedTokenIds.has(token.id))
  return unusedTokens.length === 1 ? unusedTokens[0] : undefined
}

function getFileExtension(value: string | undefined, mediaType: string | undefined) {
  const source = value ?? ''
  const fileName = source.split(/[\\/]/).pop() ?? source
  const extension = fileName.includes('.') ? `.${fileName.split('.').pop()}` : ''
  if (extension !== '.') return extension.toLowerCase()
  if (mediaType?.startsWith('image/')) return `.${mediaType.slice('image/'.length)}`
  return ''
}

function createEditableAttachment(
  part: Extract<CherryMessagePart, { type: 'file' }>,
  index: number,
  fileTokenSourceId: string
): ComposerAttachment | null {
  const path = part.url
  if (!path) return null

  const name = part.filename || path.split(/[\\/]/).pop() || `attachment-${index + 1}`
  const ext = getFileExtension(name || path, part.mediaType)
  const type = part.mediaType?.startsWith('image/') ? FILE_TYPE.IMAGE : getFileTypeByExt(ext)

  return {
    fileTokenSourceId,
    name,
    origin_name: name,
    path,
    size: 0,
    ext,
    type
  }
}

export function createEditableMessageDraft(parts: CherryMessagePart[]): EditableMessageDraft {
  const textParts = parts.filter((part): part is Extract<CherryMessagePart, { type: 'text' }> => part.type === 'text')
  const text = textParts.map((part) => part.text).join('\n\n')
  const composer = textParts.length === 1 ? readCherryMeta(textParts[0])?.composer : undefined
  const draftTokens =
    composer?.tokens.flatMap((token) =>
      isComposerDraftTokenKind(token.kind)
        ? [
            {
              ...token,
              kind: token.kind
            }
          ]
        : []
    ) ?? []
  const fileTokens = draftTokens.filter((token) => token.kind === 'file')
  const usedFileTokenIds = new Set<string>()
  const fileTokenSourceByMatchedTokenId = new Map<string, string>()
  const files = parts.flatMap((part, index) => {
    if (part.type !== 'file') return []
    const path = part.url
    const token = path ? findEditableFileToken(part, path, fileTokens, usedFileTokenIds) : undefined
    if (token) usedFileTokenIds.add(token.id)
    const cherry = readCherryMeta(part)
    const fileTokenSourceId =
      getComposerFileTokenSourceId({ fileTokenSourceId: cherry?.fileTokenSourceId }) ??
      createComposerFileTokenSourceId()
    if (token) fileTokenSourceByMatchedTokenId.set(token.id, fileTokenSourceId)
    const file = createEditableAttachment(part, index, fileTokenSourceId)
    return file ? [file] : []
  })
  const normalizedDraftTokens = draftTokens.map((token) => {
    if (token.kind !== 'file') return token

    const fileTokenSourceId = fileTokenSourceByMatchedTokenId.get(token.id)
    if (!fileTokenSourceId) return token

    const id = composerFileTokenIdFromSourceId(fileTokenSourceId)
    return token.id === id ? token : { ...token, id }
  })

  return { text, draftTokens: normalizedDraftTokens, files }
}

export function getEditableKnowledgeBases(
  draftTokens: readonly ComposerSerializedToken[],
  selectableKnowledgeBases: readonly KnowledgeBase[]
) {
  const knowledgeTokenIds = getComposerTokenIds(draftTokens, 'knowledge')
  if (knowledgeTokenIds.size === 0) return []

  return selectableKnowledgeBases.filter((base) => knowledgeTokenIds.has(chatComposerTokenId.knowledge(base)))
}
