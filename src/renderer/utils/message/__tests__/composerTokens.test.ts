import type { ExportableMessage } from '@renderer/types/messageExport'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { ComposerMessageSnapshot, ComposerMessageToken } from '@shared/data/types/uiParts'
import { withCherryMeta } from '@shared/data/types/uiParts'
import { describe, expect, it } from 'vitest'

import {
  getComposerTextFromMessage,
  getComposerTokenClipboardText,
  replaceComposerTokenPromptText
} from '../composerTokens'

function token(overrides: Partial<ComposerMessageToken> = {}): ComposerMessageToken {
  return { id: 't', kind: 'command', label: 'label', index: 0, textOffset: 0, ...overrides }
}

function snapshot(tokens: ComposerMessageToken[]): ComposerMessageSnapshot {
  return { version: 1, tokens }
}

function composerTextPart(text: string, tokens: ComposerMessageToken[]) {
  return withCherryMeta({ type: 'text', text } as Extract<CherryMessagePart, { type: 'text' }>, {
    composer: snapshot(tokens)
  })
}

function userMessage(parts: CherryMessagePart[]): ExportableMessage {
  return {
    id: 'm-1',
    role: 'user',
    topicId: 'topic-1',
    createdAt: '2024-01-01T00:00:00Z',
    status: 'success',
    parts
  } as ExportableMessage
}

describe('getComposerTokenClipboardText', () => {
  it('strips the skill: prefix and wraps with slashes', () => {
    expect(getComposerTokenClipboardText(token({ kind: 'skill', id: 'skill:review', label: 'Review' }))).toBe(
      '/review/'
    )
  })

  it('falls back to the label when a skill token has no skill: prefix', () => {
    expect(getComposerTokenClipboardText(token({ kind: 'skill', id: 'abc', label: 'Review' }))).toBe('/Review/')
  })

  it('strips the knowledge: prefix and wraps with hashes', () => {
    expect(getComposerTokenClipboardText(token({ kind: 'knowledge', id: 'knowledge:docs', label: 'Docs' }))).toBe(
      '#docs#'
    )
  })

  it('falls back to the label when a knowledge token has no knowledge: prefix', () => {
    expect(getComposerTokenClipboardText(token({ kind: 'knowledge', id: 'xyz', label: 'Docs' }))).toBe('#Docs#')
  })

  it('returns the raw label for other kinds', () => {
    expect(getComposerTokenClipboardText(token({ kind: 'file', label: 'a.txt' }))).toBe('a.txt')
  })
})

describe('replaceComposerTokenPromptText', () => {
  it('replaces the matched promptText span with the token text', () => {
    const result = replaceComposerTokenPromptText(
      '@cmd do it',
      snapshot([token({ kind: 'command', label: 'cmd-label', textOffset: 0, promptText: '@cmd' })])
    )
    expect(result).toBe('cmd-label do it')
  })

  it('keeps the original text when promptText does not match at the offset', () => {
    const result = replaceComposerTokenPromptText(
      'xcmd do it',
      snapshot([token({ kind: 'command', label: 'cmd-label', textOffset: 0, promptText: '@cmd' })])
    )
    expect(result).toBe('cmd-labelxcmd do it')
  })

  it('clamps an out-of-range textOffset into the content bounds', () => {
    const result = replaceComposerTokenPromptText(
      'short',
      snapshot([token({ kind: 'command', label: '[T]', textOffset: 100 })])
    )
    expect(result).toBe('short[T]')
  })

  it('orders same-offset tokens by index regardless of array order', () => {
    const result = replaceComposerTokenPromptText(
      '',
      snapshot([
        token({ id: 'b', kind: 'command', label: 't1', textOffset: 0, index: 1 }),
        token({ id: 'a', kind: 'command', label: 't0', textOffset: 0, index: 0 })
      ])
    )
    expect(result).toBe('t0t1')
  })
})

describe('getComposerTextFromMessage', () => {
  it('returns the fallback for a non-user role', () => {
    const message = { ...userMessage([composerTextPart('@cmd hi', [])]), role: 'assistant' } as ExportableMessage
    expect(getComposerTextFromMessage(message, 'FALLBACK')).toBe('FALLBACK')
  })

  it('returns the fallback when the message has no parts', () => {
    expect(getComposerTextFromMessage(userMessage([]), 'FALLBACK')).toBe('FALLBACK')
  })

  it('resolves composer tokens for a user message', () => {
    const message = userMessage([
      composerTextPart('@cmd do it', [
        token({ kind: 'command', label: 'cmd-label', textOffset: 0, promptText: '@cmd' })
      ])
    ])
    expect(getComposerTextFromMessage(message, 'FALLBACK')).toBe('cmd-label do it')
  })
})
