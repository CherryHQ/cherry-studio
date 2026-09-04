import { FILE_TYPE } from '@renderer/types/file'
import { parseFilePreviewUrlPath } from '@renderer/utils/filePreview'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import {
  composerFileTokenIdFromSourceId,
  createComposerFileTokenSourceId,
  getComposerFileTokenSourceId,
  readComposerFileTokenIdSuffix
} from '@renderer/utils/message/composerFileTokenSource'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { ComposerMessageTokenPayload } from '@shared/data/types/uiParts'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { getFileTypeByExt } from '@shared/utils/file'

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

function readFileTokenPayload(payload: unknown): ComposerMessageTokenPayload | undefined {
  return typeof payload === 'object' && payload !== null ? (payload as ComposerMessageTokenPayload) : undefined
}

function getFileExtension(value: string | undefined, mediaType: string | undefined) {
  const source = value ?? ''
  const fileName = source.split(/[\\/]/).pop() ?? source
  const extension = fileName.includes('.') ? `.${fileName.split('.').pop()}` : ''
  if (extension !== '.') return extension.toLowerCase()
  if (mediaType?.startsWith('image/')) return `.${mediaType.slice('image/'.length)}`
  return ''
}

async function getEditableFilePath(part: Extract<CherryMessagePart, { type: 'file' }>) {
  const cherry = readCherryMeta(part)
  if (!cherry?.composerFileKind) return undefined

  if (cherry.fileEntryId) {
    try {
      return await window.api.file.getPhysicalPath({ id: cherry.fileEntryId })
    } catch {
      return undefined
    }
  }

  return parseFilePreviewUrlPath(part.url)
}

async function createEditableAttachment(
  part: Extract<CherryMessagePart, { type: 'file' }>,
  index: number,
  fileTokenSourceId: string,
  tokenPayload: ComposerMessageTokenPayload | undefined
): Promise<ComposerAttachment | null> {
  const url = part.url
  if (!url) return null

  const name =
    tokenPayload?.origin_name ||
    tokenPayload?.name ||
    part.filename ||
    url.split(/[\\/]/).pop() ||
    `attachment-${index + 1}`
  const ext = tokenPayload?.ext || getFileExtension(name || url, part.mediaType)
  const type = part.mediaType?.startsWith('image/') ? FILE_TYPE.IMAGE : (tokenPayload?.type ?? getFileTypeByExt(ext))
  const composerFileKind = readCherryMeta(part)?.composerFileKind
  const path = await getEditableFilePath(part)

  return {
    fileTokenSourceId,
    name,
    origin_name: name,
    ...(path && { path }),
    previewUrl: url,
    size: tokenPayload?.size ?? 0,
    ext,
    type,
    ...(path && composerFileKind && { composerFileKind })
  }
}

export async function createEditableMessageDraft(parts: CherryMessagePart[]): Promise<EditableMessageDraft> {
  const textParts = parts.filter((part): part is Extract<CherryMessagePart, { type: 'text' }> => part.type === 'text')
  const text = textParts.map((part) => part.text).join('\n\n')
  // Recover the composer snapshot even when the reply was split across multiple text parts
  // (e.g. text → tool → text), so file/knowledge tokens remain restorable.
  const composer =
    textParts.length === 1
      ? readCherryMeta(textParts[0])?.composer
      : textParts.map((part) => readCherryMeta(part)?.composer).find((snapshot) => snapshot !== undefined)
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
  const attachmentByMatchedTokenId = new Map<string, ComposerAttachment>()
  const filePromises = parts.flatMap((part, index) => {
    if (part.type !== 'file') return []
    const path = part.url
    const token = path ? findEditableFileToken(part, path, fileTokens, usedFileTokenIds) : undefined
    if (token) usedFileTokenIds.add(token.id)
    const cherry = readCherryMeta(part)
    const fileTokenSourceId =
      getComposerFileTokenSourceId({ fileTokenSourceId: cherry?.fileTokenSourceId }) ??
      createComposerFileTokenSourceId()
    return [
      { token, file: createEditableAttachment(part, index, fileTokenSourceId, readFileTokenPayload(token?.payload)) }
    ]
  })
  const resolvedFiles = await Promise.all(filePromises.map(async ({ token, file }) => ({ token, file: await file })))
  const files = resolvedFiles.flatMap(({ token, file }) => {
    if (!file) return []
    if (token) attachmentByMatchedTokenId.set(token.id, file)
    return [file]
  })
  // Live composer file tokens carry the attachment as their payload; the stored snapshot only
  // carries the serialized display fields. Restore the attachment so the token renders the same.
  const normalizedDraftTokens = draftTokens.map((token) => {
    if (token.kind !== 'file') return token

    const file = attachmentByMatchedTokenId.get(token.id)
    if (!file) return token

    return { ...token, id: composerFileTokenIdFromSourceId(file.fileTokenSourceId), payload: file }
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
