import { countTokens } from 'gpt-tokenizer/encoding/o200k_base'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadGptO200kTokenizer } from '../textTokenizer'

describe('loadGptO200kTokenizer', () => {
  it('counts empty text as zero', async () => {
    const tokenizer = await loadGptO200kTokenizer()
    expect(tokenizer.count('')).toBe(0)
  })

  it.each([16_383, 16_384])('keeps exact successful counts at %i UTF-16 units', async (length) => {
    const text = 'A'.repeat(length)
    const tokenizer = await loadGptO200kTokenizer()
    expect(tokenizer.count(text)).toBe(countTokens(text, { disallowedSpecial: new Set() }))
  })

  it('byte-prices capital A immediately above the work cutoff', async () => {
    const tokenizer = await loadGptO200kTokenizer()
    expect(tokenizer.count('A'.repeat(16_385))).toBe(16_385)
  })

  it.each(['hello world', '中', '😀', '\uD800', '\uDC00', '<|endoftext|>'])(
    'preserves the exact ordinary-text count of %s',
    async (text) => {
      const tokenizer = await loadGptO200kTokenizer()
      expect(tokenizer.count(text)).toBe(countTokens(text, { disallowedSpecial: new Set() }))
    }
  )

  it('byte-prices the newline/alphabet chunk-boundary counterexample', async () => {
    const text = '\n'.repeat(16_383) + ' abcdefghijklmnopqrstuvwxyz'
    const tokenizer = await loadGptO200kTokenizer()
    expect(tokenizer.count(text)).toBe(new TextEncoder().encode(text).length)
  })

  it.each(['<|im_start|>', '<|im_end|>', '<|endoftext|>', '<|endofturn|>', '<|endofmessage|>'])(
    'counts the literal special-token text %s without rejecting the message',
    async (literal) => {
      const tokenizer = await loadGptO200kTokenizer()
      const literalTokenCount = tokenizer.count(literal)

      expect(literalTokenCount).toBeGreaterThan(1)
      expect(tokenizer.count(`Before ${literal} after`)).toBeGreaterThan(literalTokenCount)
    }
  )
})

describe('o200k dependency isolation', () => {
  afterEach(() => {
    vi.doUnmock('gpt-tokenizer/encoding/o200k_base')
    vi.resetModules()
  })

  it('does no encoder work for oversized ASCII, CJK, emoji or unpaired surrogates', async () => {
    const encoder = vi.fn(() => {
      throw new Error('oversized text must not reach the encoder')
    })
    vi.doMock('gpt-tokenizer/encoding/o200k_base', () => ({ countTokens: encoder }))
    vi.resetModules()
    const { loadGptO200kTokenizer: load } = await import('../textTokenizer')
    const tokenizer = await load()

    for (const text of [
      'A'.repeat(16_385),
      '中'.repeat(16_385),
      '😀'.repeat(8_193),
      '\uD800'.repeat(16_385),
      '\uDC00'.repeat(16_385)
    ]) {
      expect(text.length).toBeGreaterThan(16_384)
      expect(tokenizer.count(text)).toBe(new TextEncoder().encode(text).length)
    }
    expect(encoder).not.toHaveBeenCalled()
  })

  it.each([
    ['RangeError', new RangeError('Maximum call stack size exceeded')],
    ['Error', new Error('encoder failed')]
  ])('byte-prices a dependency %s and resumes exact counting afterward', async (_name, error) => {
    const encoder = vi.fn<typeof countTokens>(() => {
      throw error
    })
    vi.doMock('gpt-tokenizer/encoding/o200k_base', () => ({ countTokens: encoder }))
    vi.resetModules()
    const { loadGptO200kTokenizer: load } = await import('../textTokenizer')
    const tokenizer = await load()

    expect(tokenizer.count('')).toBe(0)
    expect(encoder).not.toHaveBeenCalled()
    for (const text of ['中', '😀', '\uD800', '\uDC00', '<|endoftext|>']) {
      expect(tokenizer.count(text)).toBe(new TextEncoder().encode(text).length)
    }
    expect(tokenizer.count('中')).toBe(3)
    expect(tokenizer.count('😀')).toBe(4)

    encoder.mockImplementation(countTokens)
    expect(tokenizer.count('hello world')).toBe(countTokens('hello world', { disallowedSpecial: new Set() }))
    expect(tokenizer.count('hello world')).toBeLessThan(new TextEncoder().encode('hello world').length)
  })

  it('keeps ranks lazy when importing and using tokenx', async () => {
    const loadRanks = vi.fn(() => ({ countTokens }))
    vi.doMock('gpt-tokenizer/encoding/o200k_base', loadRanks)
    vi.resetModules()
    const { tokenxTokenizer, loadGptO200kTokenizer: load } = await import('../textTokenizer')
    expect(tokenxTokenizer.count('hello')).toBeGreaterThan(0)
    expect(loadRanks).not.toHaveBeenCalled()
    const tokenizer = await load()
    expect(tokenizer.count('hello')).toBe(countTokens('hello', { disallowedSpecial: new Set() }))
    expect(loadRanks).toHaveBeenCalledTimes(1)
  })
})
