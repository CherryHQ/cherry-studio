import { describe, expect, it } from 'vitest'

import {
  COMPOSER_CLIPBOARD_PROMPT_TOKEN_KINDS,
  COMPOSER_CLIPBOARD_TOKEN_KINDS,
  COMPOSER_INPUT_TOKEN_KINDS,
  COMPOSER_MESSAGE_TEXT_TOKEN_KINDS,
  COMPOSER_MESSAGE_TOKEN_KINDS,
  COMPOSER_TOKEN_KINDS,
  isComposerClipboardPromptTokenKind,
  isComposerClipboardTokenKind,
  isComposerInputTokenKind,
  isComposerMessageTextTokenKind,
  isComposerMessageTokenKind,
  isComposerTokenKind
} from '../composerTokenPolicy'

describe('composerTokenPolicy', () => {
  it('keeps every portable input token available to the private rich clipboard', () => {
    // `messagePart` is the one input kind that is not content: it addresses a position inside one
    // specific message, so it must not travel to another composer, where it could only render and
    // then vanish on send.
    expect(COMPOSER_CLIPBOARD_TOKEN_KINDS).toEqual(COMPOSER_INPUT_TOKEN_KINDS.filter((kind) => kind !== 'messagePart'))
    expect(isComposerClipboardTokenKind('messagePart')).toBe(false)
  })

  it('keeps prompt variables editor-only and legacy commands message-only', () => {
    expect(isComposerInputTokenKind('promptVariable')).toBe(true)
    expect(isComposerMessageTokenKind('promptVariable')).toBe(false)
    expect(isComposerClipboardTokenKind('promptVariable')).toBe(true)

    expect(isComposerInputTokenKind('command')).toBe(false)
    expect(isComposerMessageTokenKind('command')).toBe(true)
    expect(isComposerClipboardTokenKind('command')).toBe(false)
  })

  it('derives private clipboard prompt restoration from the same capability table', () => {
    expect(COMPOSER_CLIPBOARD_PROMPT_TOKEN_KINDS).toEqual(['link', 'folder', 'reference', 'quote', 'promptVariable'])
    expect(COMPOSER_CLIPBOARD_PROMPT_TOKEN_KINDS.every(isComposerClipboardTokenKind)).toBe(true)
    expect(isComposerClipboardPromptTokenKind('skill')).toBe(false)
    expect(isComposerClipboardPromptTokenKind('file')).toBe(false)
    expect(isComposerClipboardPromptTokenKind('knowledge')).toBe(false)
  })

  it('keeps quote chips visible without projecting their label into message text', () => {
    expect(isComposerMessageTokenKind('quote')).toBe(true)
    expect(isComposerMessageTextTokenKind('quote')).toBe(false)
    expect(COMPOSER_MESSAGE_TEXT_TOKEN_KINDS).toEqual(COMPOSER_MESSAGE_TOKEN_KINDS.filter((kind) => kind !== 'quote'))
  })

  it('rejects kinds outside the unified lifecycle contract', () => {
    expect(COMPOSER_TOKEN_KINDS.every(isComposerTokenKind)).toBe(true)
    expect(isComposerTokenKind('unknown')).toBe(false)
    expect(isComposerInputTokenKind('unknown')).toBe(false)
    expect(isComposerMessageTokenKind('unknown')).toBe(false)
    expect(isComposerClipboardTokenKind('unknown')).toBe(false)
    expect(isComposerClipboardPromptTokenKind('unknown')).toBe(false)
  })
})
