import { normalizeQuoteTokenPromptText } from '@renderer/components/composer/quoteToken'
import {
  COMPOSER_INPUT_TOKEN_KINDS,
  type ComposerInputTokenKind,
  type ComposerTokenKind,
  isComposerTokenKind
} from '@renderer/utils/composerTokenPolicy'

export type ComposerDraftTokenKind = ComposerTokenKind

export const ACTIVE_COMPOSER_INPUT_TOKEN_KINDS = COMPOSER_INPUT_TOKEN_KINDS

export type ActiveComposerInputTokenKind = ComposerInputTokenKind

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
  return isComposerTokenKind(value)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Tiptap token attributes also come from restored draft JSON; accept a field only after checking that it is a string.
function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function normalizePromptText(kind: ComposerDraftTokenKind, promptText: string | undefined): string | undefined {
  if (!promptText) return undefined

  if (kind === 'quote') return normalizeQuoteTokenPromptText(promptText)

  return promptText
}

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Tiptap and restored attributes include raw extension fields; the readers below validate only supported token values.
export function normalizeComposerTokenAttrs(attrs: Record<string, unknown>): ComposerDraftToken {
  const kindValue = attrs.kind
  const kind = isComposerDraftTokenKind(kindValue) ? kindValue : 'reference'
  const label = readString(attrs.label) ?? ''
  const payload = attrs.payload ?? undefined
  const promptText = normalizePromptText(kind, readString(attrs.promptText))

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
