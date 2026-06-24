import type { ExportableMessage } from '@renderer/types/messageExport'
import type { CherryMessagePart } from '@shared/data/types/message'
import { type ComposerMessageSnapshot, type ComposerMessageToken, readCherryMeta } from '@shared/data/types/uiParts'

const RENDERABLE_COMPOSER_TOKEN_KINDS = new Set<ComposerMessageToken['kind']>([
  'command',
  'file',
  'knowledge',
  'reference',
  'skill'
])
const DISPLAY_COMPOSER_TOKEN_KINDS = new Set<ComposerMessageToken['kind']>([
  ...RENDERABLE_COMPOSER_TOKEN_KINDS,
  'quote'
])
const SKILL_TOKEN_ID_PREFIX = 'skill:'
const KNOWLEDGE_TOKEN_ID_PREFIX = 'knowledge:'

function isTextPart(part: CherryMessagePart): part is Extract<CherryMessagePart, { type: 'text' }> {
  return part.type === 'text'
}

function getMessageParts(message: ExportableMessage): CherryMessagePart[] {
  const parts = (message as { parts?: unknown }).parts
  return Array.isArray(parts) ? (parts as CherryMessagePart[]) : []
}

function getSortedComposerTokens(
  composer: ComposerMessageSnapshot,
  allowedKinds: ReadonlySet<ComposerMessageToken['kind']>
): ComposerMessageToken[] {
  return composer.tokens
    .filter((token) => allowedKinds.has(token.kind) && token.label)
    .sort((a, b) => a.textOffset - b.textOffset || a.index - b.index)
}

export function getRenderableComposerTokens(composer: ComposerMessageSnapshot): ComposerMessageToken[] {
  return getSortedComposerTokens(composer, RENDERABLE_COMPOSER_TOKEN_KINDS)
}

export function getDisplayComposerTokens(composer: ComposerMessageSnapshot): ComposerMessageToken[] {
  return getSortedComposerTokens(composer, DISPLAY_COMPOSER_TOKEN_KINDS)
}

export function getComposerTokenClipboardText(token: ComposerMessageToken): string {
  if (token.kind === 'skill') {
    const marker = token.id.startsWith(SKILL_TOKEN_ID_PREFIX)
      ? token.id.slice(SKILL_TOKEN_ID_PREFIX.length)
      : token.label
    return `/${marker}/`
  }
  if (token.kind === 'knowledge') {
    const marker = token.id.startsWith(KNOWLEDGE_TOKEN_ID_PREFIX)
      ? token.id.slice(KNOWLEDGE_TOKEN_ID_PREFIX.length)
      : token.label
    return `#${marker}#`
  }
  return token.label
}

export function replaceComposerTokenPromptText(
  content: string,
  composer: ComposerMessageSnapshot,
  getTokenText: (token: ComposerMessageToken, index: number) => string = getComposerTokenClipboardText
): string {
  const tokens = getRenderableComposerTokens(composer)
  let text = ''
  let cursor = 0

  tokens.forEach((token, index) => {
    const offset = Math.max(0, Math.min(content.length, token.textOffset))
    if (offset > cursor) {
      text += content.slice(cursor, offset)
      cursor = offset
    }

    text += getTokenText(token, index)

    if (token.promptText && content.slice(offset, offset + token.promptText.length) === token.promptText) {
      cursor = Math.max(cursor, offset + token.promptText.length)
    }
  })

  if (cursor < content.length) {
    text += content.slice(cursor)
  }

  return text
}

export function getComposerTextFromParts(
  parts: CherryMessagePart[],
  getTokenText?: (token: ComposerMessageToken, index: number) => string
): string {
  return parts
    .filter(isTextPart)
    .map((part) => {
      const composer = readCherryMeta(part)?.composer
      return composer ? replaceComposerTokenPromptText(part.text, composer, getTokenText) : part.text
    })
    .filter((text) => text.trim().length > 0)
    .join('\n\n')
}

export function getComposerTextFromMessage(
  message: ExportableMessage,
  fallbackContent: string,
  getTokenText?: (token: ComposerMessageToken, index: number) => string
): string {
  if (message.role !== 'user') return fallbackContent

  const parts = getMessageParts(message)
  if (parts.length === 0) return fallbackContent

  const composerText = getComposerTextFromParts(parts, getTokenText)
  return composerText || fallbackContent
}
