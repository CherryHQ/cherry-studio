import { normalizeQuoteTokenPromptText } from '@renderer/components/chat/utils/quoteToken'

import { CHAT_INPUT_TOKEN_KINDS, type ChatInputTokenKind } from '../tokens/tokenView'

export const COMPOSER_DRAFT_TOKEN_KINDS = [
  'skill',
  'file',
  'command',
  'knowledge',
  'reference',
  'quote',
  'promptVariable'
] as const

export type ComposerDraftTokenKind = (typeof COMPOSER_DRAFT_TOKEN_KINDS)[number]

export const ACTIVE_COMPOSER_INPUT_TOKEN_KINDS = CHAT_INPUT_TOKEN_KINDS

export type ActiveComposerInputTokenKind = ChatInputTokenKind

export interface ComposerDraftToken {
  id: string
  kind: ComposerDraftTokenKind
  label: string
  icon?: string
  description?: string
  promptText?: string
  payload?: unknown
}

export type ActiveComposerInputToken = ComposerDraftToken & { kind: ActiveComposerInputTokenKind }
export type PromptVariableComposerInputToken = ActiveComposerInputToken & { kind: 'promptVariable' }

export interface ComposerSerializedToken extends ComposerDraftToken {
  index: number
  textOffset: number
}

export interface ComposerSerializedDraft {
  text: string
  tokens: ComposerSerializedToken[]
}

export function isComposerDraftTokenKind(value: unknown): value is ComposerDraftTokenKind {
  return typeof value === 'string' && COMPOSER_DRAFT_TOKEN_KINDS.includes(value as ComposerDraftTokenKind)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readPayload(value: unknown): unknown | undefined {
  return value == null ? undefined : value
}

function normalizePromptText(kind: ComposerDraftTokenKind, value: unknown): string | undefined {
  const promptText = readString(value)
  if (!promptText) return undefined
  if (kind === 'quote') return normalizeQuoteTokenPromptText(promptText)
  return promptText
}

export function normalizeComposerTokenAttrs(attrs: Record<string, unknown>): ComposerDraftToken {
  const kindValue = attrs.kind
  const kind = isComposerDraftTokenKind(kindValue) ? kindValue : 'reference'
  const label = readString(attrs.label) ?? ''
  const payload = readPayload(attrs.payload)
  const promptText = normalizePromptText(kind, attrs.promptText)

  return {
    id: readString(attrs.id) ?? label,
    kind,
    label,
    ...(readString(attrs.icon) && { icon: readString(attrs.icon) }),
    ...(readString(attrs.description) && { description: readString(attrs.description) }),
    ...(promptText && { promptText }),
    ...(payload !== undefined && { payload })
  }
}
