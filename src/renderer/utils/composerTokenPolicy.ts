import type { ComposerMessageTokenKind } from '@shared/data/types/uiParts'

interface ComposerTokenCapabilities {
  input: boolean
  message: boolean
  messageText: boolean
  clipboard: boolean
  clipboardPromptText: boolean
}

/**
 * Single renderer contract for token lifecycle capabilities.
 *
 * Variant-owned state (files, knowledge bases, skills) remains a composer concern, but generic
 * boundaries derive their supported token kinds from this table instead of maintaining parallel
 * allowlists.
 */
export const COMPOSER_TOKEN_CAPABILITIES = {
  skill: { input: true, message: true, messageText: true, clipboard: true, clipboardPromptText: false },
  link: { input: true, message: true, messageText: true, clipboard: true, clipboardPromptText: true },
  file: { input: true, message: true, messageText: true, clipboard: true, clipboardPromptText: false },
  folder: { input: true, message: true, messageText: true, clipboard: true, clipboardPromptText: true },
  command: { input: false, message: true, messageText: true, clipboard: false, clipboardPromptText: false },
  knowledge: { input: true, message: true, messageText: true, clipboard: true, clipboardPromptText: false },
  reference: { input: true, message: true, messageText: true, clipboard: true, clipboardPromptText: true },
  quote: { input: true, message: true, messageText: false, clipboard: true, clipboardPromptText: true },
  promptVariable: { input: true, message: false, messageText: false, clipboard: true, clipboardPromptText: true },
  // Editor-only anchor holding a non-editable message part's place while its message is edited.
  // Clipboard-eligible like every other input kind, so cutting and re-pasting a chip inside one
  // edit session moves its part instead of dropping it.
  messagePart: { input: true, message: false, messageText: false, clipboard: true, clipboardPromptText: false }
} as const satisfies Record<ComposerMessageTokenKind | 'promptVariable' | 'messagePart', ComposerTokenCapabilities>

export type ComposerTokenKind = keyof typeof COMPOSER_TOKEN_CAPABILITIES
type ComposerTokenCapability = keyof ComposerTokenCapabilities
type ComposerTokenKindWithCapability<TCapability extends ComposerTokenCapability> = {
  [TKind in ComposerTokenKind]: (typeof COMPOSER_TOKEN_CAPABILITIES)[TKind][TCapability] extends true ? TKind : never
}[ComposerTokenKind]

export type ComposerInputTokenKind = ComposerTokenKindWithCapability<'input'>
export type ComposerPersistedMessageTokenKind = ComposerTokenKindWithCapability<'message'>
export type ComposerMessageTextTokenKind = ComposerTokenKindWithCapability<'messageText'>
export type ComposerClipboardTokenKind = ComposerTokenKindWithCapability<'clipboard'>
export type ComposerClipboardPromptTokenKind = ComposerTokenKindWithCapability<'clipboardPromptText'>

export const COMPOSER_TOKEN_KINDS = Object.freeze(Object.keys(COMPOSER_TOKEN_CAPABILITIES) as ComposerTokenKind[])

function getComposerTokenKinds<TCapability extends ComposerTokenCapability>(
  capability: TCapability
): readonly ComposerTokenKindWithCapability<TCapability>[] {
  return COMPOSER_TOKEN_KINDS.filter(
    (kind): kind is ComposerTokenKindWithCapability<TCapability> => COMPOSER_TOKEN_CAPABILITIES[kind][capability]
  )
}

export const COMPOSER_INPUT_TOKEN_KINDS = getComposerTokenKinds('input')
export const COMPOSER_MESSAGE_TOKEN_KINDS = getComposerTokenKinds('message')
export const COMPOSER_MESSAGE_TEXT_TOKEN_KINDS = getComposerTokenKinds('messageText')
export const COMPOSER_CLIPBOARD_TOKEN_KINDS = getComposerTokenKinds('clipboard')
export const COMPOSER_CLIPBOARD_PROMPT_TOKEN_KINDS = getComposerTokenKinds('clipboardPromptText')

const composerTokenKindSet = new Set<string>(COMPOSER_TOKEN_KINDS)
const composerInputTokenKindSet = new Set<string>(COMPOSER_INPUT_TOKEN_KINDS)
const composerMessageTokenKindSet = new Set<string>(COMPOSER_MESSAGE_TOKEN_KINDS)
const composerMessageTextTokenKindSet = new Set<string>(COMPOSER_MESSAGE_TEXT_TOKEN_KINDS)
const composerClipboardTokenKindSet = new Set<string>(COMPOSER_CLIPBOARD_TOKEN_KINDS)
const composerClipboardPromptTokenKindSet = new Set<string>(COMPOSER_CLIPBOARD_PROMPT_TOKEN_KINDS)

export function isComposerTokenKind(value: unknown): value is ComposerTokenKind {
  return typeof value === 'string' && composerTokenKindSet.has(value)
}

export function isComposerInputTokenKind(value: unknown): value is ComposerInputTokenKind {
  return typeof value === 'string' && composerInputTokenKindSet.has(value)
}

export function isComposerMessageTokenKind(value: unknown): value is ComposerPersistedMessageTokenKind {
  return typeof value === 'string' && composerMessageTokenKindSet.has(value)
}

export function isComposerMessageTextTokenKind(value: unknown): value is ComposerMessageTextTokenKind {
  return typeof value === 'string' && composerMessageTextTokenKindSet.has(value)
}

export function isComposerClipboardTokenKind(value: unknown): value is ComposerClipboardTokenKind {
  return typeof value === 'string' && composerClipboardTokenKindSet.has(value)
}

export function isComposerClipboardPromptTokenKind(value: unknown): value is ComposerClipboardPromptTokenKind {
  return typeof value === 'string' && composerClipboardPromptTokenKindSet.has(value)
}
