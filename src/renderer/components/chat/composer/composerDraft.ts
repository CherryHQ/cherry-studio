import { FileTypeSchema } from '@shared/data/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import type {
  CherryProviderMetadata,
  ComposerMessageSnapshot,
  ComposerMessageToken,
  ComposerMessageTokenPayload
} from '@shared/data/types/uiParts'
import type { Editor, JSONContent } from '@tiptap/core'

import { COMPOSER_TOKEN_NODE_NAME } from './ComposerTokenNode'
import type { ComposerSerializedDraft, ComposerSerializedToken } from './tokens'
import { normalizeComposerTokenAttrs } from './tokens'

const COMPOSER_MESSAGE_SNAPSHOT_VERSION = 1

type ComposerSerializableSource = Pick<Editor, 'getJSON'> | JSONContent
const RESTORABLE_COMPOSER_MESSAGE_TOKEN_KINDS = new Set<ComposerMessageToken['kind']>([
  'skill',
  'file',
  'command',
  'knowledge',
  'reference',
  'quote'
])
type PersistedComposerSerializedToken = ComposerSerializedToken & {
  kind: Exclude<ComposerSerializedToken['kind'], 'promptVariable'>
}
type RestoredComposerToken = Omit<ComposerMessageToken, 'index' | 'textOffset'> & {
  payload?: ComposerMessageTokenPayload & {
    restoredTextSuffix?: string
  }
}

function isEditorSource(source: ComposerSerializableSource): source is Pick<Editor, 'getJSON'> {
  return typeof (source as Pick<Editor, 'getJSON'>).getJSON === 'function'
}

function appendTextContent(nodes: JSONContent[], text: string) {
  text.split(/\r\n?|\n/).forEach((line, index) => {
    if (index > 0) nodes.push({ type: 'hardBreak' })
    if (line) nodes.push({ type: 'text', text: line })
  })
}

function getRestoredTextSuffix(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return ''

  const restoredTextSuffix = (payload as Record<string, unknown>).restoredTextSuffix
  return typeof restoredTextSuffix === 'string' ? restoredTextSuffix : ''
}

function readPayloadObject(payload: unknown): Record<string, unknown> | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
  return payload as Record<string, unknown>
}

function readPayloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function createDisplayFileTokenPayload(token: ComposerSerializedToken): ComposerMessageTokenPayload | undefined {
  if (token.kind !== 'file') return undefined

  const payload = readPayloadObject(token.payload)
  if (!payload) return undefined

  const displayPayload: ComposerMessageTokenPayload = {}
  const type = FileTypeSchema.safeParse(payload.type)
  if (type.success) displayPayload.type = type.data

  const ext = readPayloadString(payload, 'ext')
  if (ext) displayPayload.ext = ext

  const name = readPayloadString(payload, 'name')
  if (name) displayPayload.name = name

  const originName = readPayloadString(payload, 'origin_name')
  if (originName) displayPayload.origin_name = originName

  if (typeof payload.size === 'number') displayPayload.size = payload.size

  return Object.keys(displayPayload).length > 0 ? displayPayload : undefined
}

function getRestorableQuoteTextSuffix(text: string, start: number): string {
  if (text.startsWith('\r\n', start)) return '\r\n'

  const next = text[start]
  return next === ' ' || next === '\n' || next === '\r' ? next : ''
}

function createComposerTokenNode(token: ComposerMessageToken, restoredTextSuffix = ''): JSONContent {
  const basePayload = readPayloadObject(token.payload)
  const payload = restoredTextSuffix ? { ...basePayload, restoredTextSuffix } : basePayload
  const attrs: RestoredComposerToken = {
    id: token.id,
    kind: token.kind,
    label: token.label,
    ...(token.icon && { icon: token.icon }),
    ...(token.description && { description: token.description }),
    ...(token.promptText && { promptText: token.promptText }),
    ...(payload && { payload })
  }

  return {
    type: COMPOSER_TOKEN_NODE_NAME,
    attrs
  }
}

export function createComposerDocumentContent(text: string, composer?: ComposerMessageSnapshot): JSONContent {
  const nodes: JSONContent[] = []
  const tokens = composer?.tokens
    .filter((token) => RESTORABLE_COMPOSER_MESSAGE_TOKEN_KINDS.has(token.kind) && token.label)
    .toSorted((a, b) => a.textOffset - b.textOffset || a.index - b.index)

  if (!tokens?.length) {
    appendTextContent(nodes, text)
    return {
      type: 'doc',
      content: [{ type: 'paragraph', ...(nodes.length > 0 && { content: nodes }) }]
    }
  }

  let cursor = 0
  tokens.forEach((token) => {
    const offset = Math.max(cursor, Math.min(text.length, token.textOffset))
    if (offset > cursor) {
      appendTextContent(nodes, text.slice(cursor, offset))
      cursor = offset
    }

    const promptText = token.promptText
    const promptTextMatches = !!promptText && text.slice(offset, offset + promptText.length) === promptText
    if (promptText && !promptTextMatches) return

    const restoredTextSuffix =
      promptTextMatches && token.kind === 'quote' ? getRestorableQuoteTextSuffix(text, offset + promptText.length) : ''

    nodes.push(createComposerTokenNode(token, restoredTextSuffix))

    if (promptTextMatches) {
      cursor = offset + promptText.length + restoredTextSuffix.length
    }
  })

  if (cursor < text.length) {
    appendTextContent(nodes, text.slice(cursor))
  }

  return {
    type: 'doc',
    content: [{ type: 'paragraph', ...(nodes.length > 0 && { content: nodes }) }]
  }
}

export function serializeComposerDocument(source: ComposerSerializableSource): ComposerSerializedDraft {
  const json = isEditorSource(source) ? source.getJSON() : source
  const tokens: ComposerSerializedToken[] = []
  let text = ''

  const visitNode = (node: JSONContent) => {
    if (node.type === 'text') {
      text += node.text ?? ''
      return
    }

    if (node.type === 'hardBreak') {
      text += '\n'
      return
    }

    if (node.type === COMPOSER_TOKEN_NODE_NAME) {
      const token = normalizeComposerTokenAttrs(node.attrs ?? {})
      const restoredTextSuffix = getRestoredTextSuffix(token.payload)
      tokens.push({
        ...token,
        index: tokens.length,
        textOffset: text.length
      })
      text += token.promptText ?? ''
      text += restoredTextSuffix
      return
    }

    if (!node.content?.length) return

    if (node.type === 'doc') {
      node.content.forEach((child, index) => {
        if (index > 0) text += '\n'
        visitNode(child)
      })
      return
    }

    node.content.forEach(visitNode)
  }

  visitNode(json)

  return { text, tokens }
}

export function createComposerMessageSnapshot(draft: ComposerSerializedDraft): ComposerMessageSnapshot | undefined {
  const visibleTokens = draft.tokens.filter(
    (token): token is PersistedComposerSerializedToken => token.kind !== 'promptVariable'
  )
  if (visibleTokens.length === 0) return undefined

  return {
    version: COMPOSER_MESSAGE_SNAPSHOT_VERSION,
    tokens: visibleTokens.map((token) => {
      const { id, kind, label, icon, description, index, textOffset, promptText } = token
      const payload = createDisplayFileTokenPayload(token)

      return {
        id,
        kind,
        label,
        ...(icon && { icon }),
        ...(description && { description }),
        index,
        textOffset,
        ...(promptText && { promptText }),
        ...(payload && { payload })
      }
    })
  }
}

function createComposerTextPart(text: string, composer?: ComposerMessageSnapshot): CherryMessagePart {
  if (!composer) return { type: 'text', text } as CherryMessagePart

  const cherry: CherryProviderMetadata = { composer }
  return {
    type: 'text',
    text,
    providerMetadata: {
      cherry
    }
  } as unknown as CherryMessagePart
}

/**
 * Builds the user message parts from a serialized draft. Returns only the text
 * part (carrying the composer snapshot). File parts are created at send time
 * from `ComposerAttachment`s via `buildFilePartsForAttachments`, not here.
 */
export function createComposerUserMessageParts(draft: ComposerSerializedDraft): CherryMessagePart[] {
  return [createComposerTextPart(draft.text, createComposerMessageSnapshot(draft))]
}
