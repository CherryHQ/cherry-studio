import { isComposerInputTokenKind, isComposerMessageTokenKind } from '@renderer/utils/composerTokenPolicy'
import type { CherryMessagePart } from '@shared/data/types/message'
import type {
  CherryProviderMetadata,
  ComposerMessageSnapshot,
  ComposerMessageToken,
  ComposerMessageTokenPayload
} from '@shared/data/types/uiParts'
import { FileTypeSchema } from '@shared/types/file'
import type { JSONContent } from '@tiptap/core'

import { createPromptVariableContent } from './promptVariables'
import type { ComposerDraftToken, ComposerSerializedDraft, ComposerSerializedToken } from './tokens'
import { COMPOSER_TOKEN_NODE_NAME } from './tokens'

export { getComposerSerializedTextLength, serializeComposerDocument } from './composerDocumentSerializer'
export { COMPOSER_INPUT_MAX_LENGTH } from './tokens'

const COMPOSER_MESSAGE_SNAPSHOT_VERSION = 1

type PersistedComposerSerializedToken = ComposerSerializedToken & {
  kind: ComposerMessageToken['kind']
}

function appendTextContent(nodes: JSONContent[], text: string) {
  text.split(/\r\n?|\n/).forEach((line, index) => {
    if (index > 0) nodes.push({ type: 'hardBreak' })
    if (line) nodes.push({ type: 'text', text: line })
  })
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

function createComposerTokenNode(
  token: ComposerSerializedToken | ComposerMessageToken,
  restoredTextSuffix = ''
): JSONContent {
  const basePayload = readPayloadObject(token.payload)
  const payload = restoredTextSuffix ? { ...basePayload, restoredTextSuffix } : basePayload
  const attrs: ComposerDraftToken = {
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

function createComposerContent(
  text: string,
  sourceTokens: readonly (ComposerSerializedToken | ComposerMessageToken)[],
  isRestorableKind: (kind: ComposerSerializedToken['kind']) => boolean
): JSONContent {
  const nodes: JSONContent[] = []
  const tokens = sourceTokens
    .filter((token) => isRestorableKind(token.kind) && token.label)
    .toSorted((a, b) => a.textOffset - b.textOffset || a.index - b.index)

  if (!tokens.length) {
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

export function createComposerDocumentContent(text: string, composer?: ComposerMessageSnapshot): JSONContent {
  return createComposerContent(text, composer?.tokens ?? [], isComposerMessageTokenKind)
}

export function createComposerDraftContent(draft: {
  text: string
  tokens: readonly ComposerSerializedToken[]
}): JSONContent {
  const inputTokens = draft.tokens.filter((token) => isComposerInputTokenKind(token.kind))
  if (!inputTokens.length) return createPromptVariableContent(draft.text)

  return createComposerContent(draft.text, inputTokens, isComposerInputTokenKind)
}

/**
 * Drops the tokens a persistence layer cannot carry, taking the prompt text each one contributed with
 * it. `serializeComposerDocument` folds `promptText` into the draft text, so filtering the token alone
 * strands its sentence as ordinary prose — for a knowledge token that means a restored draft still
 * telling the model a base is attached after the chip, and with it the scope part, is gone.
 *
 * The separator space the editor inserts after a chip is swallowed along with the sentence, so a
 * pick-only draft collapses back to empty rather than to whitespace.
 */
export function excludeComposerDraftTokens(
  draft: ComposerSerializedDraft,
  shouldExclude: (token: ComposerSerializedToken) => boolean
): ComposerSerializedDraft {
  if (!draft.tokens.some(shouldExclude)) return draft

  // Merged into disjoint ascending ranges so the splice below and `rebase` agree on exactly how much
  // text was removed before any given offset — overlapping cuts would otherwise be double-counted.
  const cuts: Array<{ start: number; end: number }> = []
  draft.tokens
    .filter(shouldExclude)
    .map((token) => {
      const start = Math.min(draft.text.length, Math.max(0, token.textOffset))
      const promptText = token.promptText ?? ''
      // The prompt text has moved (the user edited over it), so there is no span we can safely cut —
      // drop the token and leave the prose alone rather than slicing through what they wrote.
      if (!promptText || !draft.text.startsWith(promptText, start)) return { start, end: start }
      const end = start + promptText.length
      return { start, end: draft.text[end] === ' ' ? end + 1 : end }
    })
    .filter((cut) => cut.end > cut.start)
    .sort((first, second) => first.start - second.start)
    .forEach((cut) => {
      const previous = cuts.at(-1)
      if (previous && cut.start <= previous.end) previous.end = Math.max(previous.end, cut.end)
      else cuts.push({ ...cut })
    })

  let text = ''
  let cursor = 0
  cuts.forEach((cut) => {
    text += draft.text.slice(cursor, cut.start)
    cursor = cut.end
  })
  text += draft.text.slice(cursor)

  /** An offset landing inside a removed range collapses to where that range started. */
  const rebase = (offset: number) => {
    let removed = 0
    for (const cut of cuts) {
      if (cut.start >= offset) break
      removed += Math.min(offset, cut.end) - cut.start
    }
    return offset - removed
  }

  return {
    text,
    tokens: draft.tokens
      .filter((token) => !shouldExclude(token))
      .map((token, index) => ({ ...token, index, textOffset: rebase(Math.max(0, token.textOffset)) }))
  }
}

type ComposerLineRange = {
  start: number
  contentEnd: number
}

function getComposerLineRanges(text: string): ComposerLineRange[] {
  const lines: ComposerLineRange[] = []
  let start = 0

  for (let index = 0; index <= text.length; index += 1) {
    if (index < text.length && text[index] !== '\n') continue

    const contentEnd = index > start && text[index - 1] === '\r' ? index - 1 : index
    lines.push({ start, contentEnd })
    start = index + 1
  }

  return lines
}

/**
 * Removes token-free blank lines only at the document boundaries. Whitespace
 * inside the first and last meaningful lines, plus all internal blank lines,
 * remains untouched.
 */
export function trimComposerDraftBoundaryBlankLines(draft: ComposerSerializedDraft): ComposerSerializedDraft {
  const lines = getComposerLineRanges(draft.text)
  const tokenRanges = draft.tokens.map((token) => {
    const start = Math.min(draft.text.length, Math.max(0, token.textOffset))
    const end = Math.min(draft.text.length, start + (token.promptText?.length ?? 0))
    return { start, end }
  })
  const meaningfulLineIndexes = lines.flatMap((line, index) => {
    const hasText = draft.text.slice(line.start, line.contentEnd).trim().length > 0
    const hasToken = tokenRanges.some((token) => token.start <= line.contentEnd && token.end >= line.start)
    return hasText || hasToken ? [index] : []
  })

  const firstMeaningfulLineIndex = meaningfulLineIndexes[0]
  if (firstMeaningfulLineIndex === undefined) {
    return draft.text.length === 0 ? draft : { ...draft, text: '', tokens: [] }
  }

  const lastMeaningfulLineIndex = meaningfulLineIndexes.at(-1) ?? firstMeaningfulLineIndex
  const start = lines[firstMeaningfulLineIndex].start
  const end = lines[lastMeaningfulLineIndex].contentEnd
  if (start === 0 && end === draft.text.length) return draft

  const text = draft.text.slice(start, end)
  const tokens = draft.tokens.map((token) => ({
    ...token,
    textOffset: Math.min(text.length, Math.max(0, token.textOffset - start))
  }))

  return { text, tokens }
}

export function createComposerMessageSnapshot(draft: ComposerSerializedDraft): ComposerMessageSnapshot | undefined {
  const visibleTokens = draft.tokens.filter((token): token is PersistedComposerSerializedToken =>
    isComposerMessageTokenKind(token.kind)
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
 * The draft must already be normalized with `trimComposerDraftBoundaryBlankLines`.
 */
export function createComposerUserMessageParts(draft: ComposerSerializedDraft): CherryMessagePart[] {
  return [createComposerTextPart(draft.text, createComposerMessageSnapshot(draft))]
}
