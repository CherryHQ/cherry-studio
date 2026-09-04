import i18n from '@renderer/i18n/resolver'
import { FILE_TYPE } from '@renderer/types/file'
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

import { trimTextBoundaryBlankLines } from '../../composerDraft'
import { type ComposerSerializedDraft, type ComposerSerializedToken, isComposerDraftTokenKind } from '../../tokens'
import { chatComposerTokenId, getComposerTokenIds } from '../chatComposerTokens'

export interface EditableMessageDraft {
  text: string
  draftTokens: ComposerSerializedToken[]
  files: ComposerAttachment[]
}

interface MessagePartAnchorPayload {
  partIndex: number
}

/** Index span from the first to the last text part — the only stretch an edit can rewrite. */
function getEditableTextSpan(parts: CherryMessagePart[]): { start: number; end: number } | null {
  const start = parts.findIndex((part) => part.type === 'text')
  return start === -1 ? null : { start, end: parts.findLastIndex((part) => part.type === 'text') }
}

function getAnchorLabel(part: CherryMessagePart): string {
  if (part.type === 'reasoning') return i18n.t('chat.input.editing_part.reasoning')

  const toolName =
    part.type === 'dynamic-tool'
      ? part.toolName
      : part.type.startsWith('tool-')
        ? part.type.slice('tool-'.length)
        : undefined
  return toolName
    ? i18n.t('chat.input.editing_part.tool', { name: toolName })
    : i18n.t('chat.input.editing_part.content')
}

function readAnchorPartIndex(token: ComposerSerializedToken): number | undefined {
  if (token.kind !== 'messagePart') return undefined

  const payload = token.payload
  if (typeof payload !== 'object' || payload === null) return undefined

  const { partIndex } = payload as MessagePartAnchorPayload
  return Number.isInteger(partIndex) ? partIndex : undefined
}

/**
 * Text parts joined by `\n\n`, with an anchor token standing in for every other part between
 * them. The editor tracks each anchor's position through the edit, so write-back can split the
 * draft there instead of collapsing `text → tool → text` into `text text → tool`. Parts outside
 * the text span keep their side of the message and need no anchor.
 *
 * An anchor is fenced by one newline on each side rather than a blank line: that puts the chip on
 * its own line, and because the chip itself occupies no characters, deleting it leaves exactly the
 * `\n\n` that already separates two text parts — no blank-line residue in the saved message.
 */
function buildEditableText(parts: CherryMessagePart[]): { text: string; anchors: ComposerSerializedToken[] } {
  const span = getEditableTextSpan(parts)
  if (!span) return { text: '', anchors: [] }

  let text = ''
  const anchors: ComposerSerializedToken[] = []
  const openLine = () => {
    if (text && !text.endsWith('\n')) text += '\n'
  }

  for (let index = span.start; index <= span.end; index++) {
    const part = parts[index]
    if (part.type === 'file' || part.type === 'data-translation') continue

    if (part.type === 'text') {
      if (text && !text.endsWith('\n')) text += '\n\n'
      text += part.text
      continue
    }

    openLine()
    anchors.push({
      id: `message-part:${index}`,
      kind: 'messagePart',
      label: getAnchorLabel(part),
      index: anchors.length,
      textOffset: text.length,
      payload: { partIndex: index } satisfies MessagePartAnchorPayload
    })
    text += '\n'
  }

  return { text, anchors }
}

/**
 * Splices an edited draft back over the parts it was built from. Each surviving anchor keeps its
 * part where it was and splits the draft text around it, so an edit moves text only. `file` and
 * `data-translation` parts are dropped: the edited payload re-emits attachments, and translations
 * are derived from the text being replaced.
 */
export function replaceEditedMessageParts(
  originalParts: CherryMessagePart[],
  draft: ComposerSerializedDraft,
  editedParts: CherryMessagePart[]
): CherryMessagePart[] {
  const span = getEditableTextSpan(originalParts)
  if (!span) return editedParts

  const isKeptOutsideSpan = (part: CherryMessagePart) => part.type !== 'file' && part.type !== 'data-translation'
  const prefix = originalParts.slice(0, span.start).filter(isKeptOutsideSpan)
  const suffix = originalParts.slice(span.end + 1).filter(isKeptOutsideSpan)

  const anchors = draft.tokens
    .flatMap((token) => {
      const partIndex = readAnchorPartIndex(token)
      if (partIndex === undefined || partIndex <= span.start || partIndex >= span.end) return []
      return [{ token, partIndex, part: originalParts[partIndex] }]
    })
    .toSorted((a, b) => a.token.textOffset - b.token.textOffset || a.token.index - b.token.index)

  if (!anchors.length) return [...prefix, ...editedParts, ...suffix]

  const [textTemplate, ...tail] = editedParts
  const body: CherryMessagePart[] = []
  const anchoredPartIndexes = new Set<number>()
  let cursor = 0

  const pushText = (value: string) => {
    const text = trimTextBoundaryBlankLines(value)
    if (!text) return
    const template = body.some((part) => part.type === 'text') ? undefined : textTemplate
    body.push(template?.type === 'text' ? { ...template, text } : ({ type: 'text', text } as CherryMessagePart))
  }

  for (const anchor of anchors) {
    if (anchoredPartIndexes.has(anchor.partIndex)) continue
    anchoredPartIndexes.add(anchor.partIndex)

    const offset = Math.min(draft.text.length, Math.max(cursor, anchor.token.textOffset))
    pushText(draft.text.slice(cursor, offset))
    body.push(anchor.part)
    cursor = offset
  }
  pushText(draft.text.slice(cursor))

  return [...prefix, ...body, ...tail, ...suffix]
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

function createEditableAttachment(
  part: Extract<CherryMessagePart, { type: 'file' }>,
  index: number,
  fileTokenSourceId: string,
  tokenPayload: ComposerMessageTokenPayload | undefined
): ComposerAttachment | null {
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

  return {
    fileTokenSourceId,
    name,
    origin_name: name,
    // The stored part carries a `file://` URL, not a filesystem path. Leave the
    // path absent rather than smuggling a URL through a path-typed field: the
    // edit flow re-sends the original part verbatim, so nothing downstream
    // needs it.
    path: undefined,
    previewUrl: url,
    size: tokenPayload?.size ?? 0,
    ext,
    type
  }
}

export function createEditableMessageDraft(parts: CherryMessagePart[]): EditableMessageDraft {
  const textParts = parts.filter((part): part is Extract<CherryMessagePart, { type: 'text' }> => part.type === 'text')
  const { text, anchors } = buildEditableText(parts)
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
  const files = parts.flatMap((part, index) => {
    if (part.type !== 'file') return []
    const path = part.url
    const token = path ? findEditableFileToken(part, path, fileTokens, usedFileTokenIds) : undefined
    if (token) usedFileTokenIds.add(token.id)
    const cherry = readCherryMeta(part)
    const fileTokenSourceId =
      getComposerFileTokenSourceId({ fileTokenSourceId: cherry?.fileTokenSourceId }) ??
      createComposerFileTokenSourceId()
    const file = createEditableAttachment(part, index, fileTokenSourceId, readFileTokenPayload(token?.payload))
    if (token && file) attachmentByMatchedTokenId.set(token.id, file)
    return file ? [file] : []
  })
  // Live composer file tokens carry the attachment as their payload; the stored snapshot only
  // carries the serialized display fields. Restore the attachment so the token renders the same.
  const normalizedDraftTokens = draftTokens.map((token) => {
    if (token.kind !== 'file') return token

    const file = attachmentByMatchedTokenId.get(token.id)
    if (!file) return token

    return { ...token, id: composerFileTokenIdFromSourceId(file.fileTokenSourceId), payload: file }
  })

  return { text, draftTokens: [...normalizedDraftTokens, ...anchors], files }
}

export function getEditableKnowledgeBases(
  draftTokens: readonly ComposerSerializedToken[],
  selectableKnowledgeBases: readonly KnowledgeBase[]
) {
  const knowledgeTokenIds = getComposerTokenIds(draftTokens, 'knowledge')
  if (knowledgeTokenIds.size === 0) return []

  return selectableKnowledgeBases.filter((base) => knowledgeTokenIds.has(chatComposerTokenId.knowledge(base)))
}
