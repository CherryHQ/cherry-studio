import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import { hasSignedReasoningMetadata, replaceReasoningPartText } from '../reasoningEditing'

const reasoningPart = (text: string, extra: Record<string, unknown> = {}): CherryMessagePart => ({
  type: 'reasoning',
  text,
  state: 'done',
  ...extra
})

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text })

describe('replaceReasoningPartText', () => {
  it('rewrites only the addressed reasoning part', () => {
    const parts = [textPart('answer'), reasoningPart('old thought'), textPart('tail')]

    const next = replaceReasoningPartText(parts, 1, 'new thought')

    expect(next).not.toBe(parts)
    expect((next[1] as { text: string }).text).toBe('new thought')
    expect((next[1] as { state?: string }).state).toBe('done')
    expect(next[0]).toBe(parts[0])
    expect(next[2]).toBe(parts[2])
  })

  it('keeps cherry timing metadata but drops provider signatures that signed the old text', () => {
    const parts = [
      reasoningPart('old thought', {
        providerMetadata: {
          cherry: { thinkingMs: 1200, startedAt: 1700000000000 },
          openai: { itemId: 'rs_123' },
          google: { thoughtSignature: 'sig' }
        }
      })
    ]

    const [next] = replaceReasoningPartText(parts, 0, 'new thought')

    expect(next).toMatchObject({
      type: 'reasoning',
      text: 'new thought',
      providerMetadata: { cherry: { thinkingMs: 1200, startedAt: 1700000000000 } }
    })
    expect((next as { providerMetadata: Record<string, unknown> }).providerMetadata).not.toHaveProperty('openai')
    expect((next as { providerMetadata: Record<string, unknown> }).providerMetadata).not.toHaveProperty('google')
  })

  it('returns the original array when the text is unchanged', () => {
    const parts = [reasoningPart('same thought')]

    expect(replaceReasoningPartText(parts, 0, 'same thought')).toBe(parts)
  })

  it('ignores an index that is missing or not a reasoning part', () => {
    const parts = [textPart('answer')]

    expect(replaceReasoningPartText(parts, 0, 'nope')).toBe(parts)
    expect(replaceReasoningPartText(parts, 9, 'nope')).toBe(parts)
  })
})

describe('hasSignedReasoningMetadata', () => {
  it('treats plain reasoning and cherry timing as unsigned', () => {
    expect(hasSignedReasoningMetadata(reasoningPart('plain thought'))).toBe(false)
    expect(
      hasSignedReasoningMetadata(reasoningPart('timed thought', { providerMetadata: { cherry: { thinkingMs: 5 } } }))
    ).toBe(false)
  })

  it('detects replay metadata from signing providers', () => {
    expect(
      hasSignedReasoningMetadata(reasoningPart('signed thought', { providerMetadata: { openai: { itemId: 'rs_1' } } }))
    ).toBe(true)
    expect(
      hasSignedReasoningMetadata(
        reasoningPart('signed thought', { providerMetadata: { anthropic: { signature: 'sig' } } })
      )
    ).toBe(true)
    expect(
      hasSignedReasoningMetadata(
        reasoningPart('signed thought', { providerMetadata: { google: { thoughtSignature: 'sig' } } })
      )
    ).toBe(true)
  })

  it('ignores parts that are not reasoning', () => {
    expect(hasSignedReasoningMetadata(textPart('answer'))).toBe(false)
  })
})
