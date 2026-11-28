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
  sourceMessageId?: string
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
  const sourceMessageId = kind === 'quote' ? readString(attrs.sourceMessageId) : undefined

  return {
    id: readString(attrs.id) ?? label,
    kind,
    label,
    ...(readString(attrs.icon) && { icon: readString(attrs.icon) }),
    ...(readString(attrs.description) && { description: readString(attrs.description) }),
    ...(promptText && { promptText }),
    ...(sourceMessageId && { sourceMessageId }),
    ...(payload !== undefined && { payload })
  }
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
