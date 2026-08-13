import type { TextTokenizer } from '@main/ai/tokens/textTokenizer'
import { describe, expect, it } from 'vitest'

import { boundedBodyTokens } from '../fallbackEstimate'

const fake: TextTokenizer = { id: 'fake', count: (t) => t.length }

describe('boundedBodyTokens', () => {
  it('sums the lengths of short strings across nested arrays/objects', () => {
    expect(boundedBodyTokens({ a: 'hi', b: ['x', 'yz'] }, fake)).toBe('hi'.length + 'x'.length + 'yz'.length)
  })

  it('prices known media carriers (anthropic source, gemini inlineData, data URLs) as a small constant', () => {
    const big = 'A'.repeat(1_000_000)
    const anthropic = { source: { type: 'base64', media_type: 'image/png', data: big } }
    expect(boundedBodyTokens(anthropic, fake)).toBe(1_500 + 'base64'.length + 'image/png'.length)
    const gemini = { inlineData: { mimeType: 'image/png', data: big } }
    expect(boundedBodyTokens(gemini, fake)).toBe(1_500 + 'image/png'.length)
    expect(boundedBodyTokens({ url: `data:image/png;base64,${big}` }, fake)).toBe(1_500)
  })

  it('estimates a long ordinary text prompt as text via sample extrapolation, not one media constant', () => {
    // A 100k+ char prompt through the fallback must not report ~1500 tokens — that would
    // defer client compaction until the downstream context limit is hit.
    const prompt = 'lorem ipsum dolor sit amet '.repeat(5_000)
    const count = boundedBodyTokens({ messages: [{ role: 'user', content: prompt }] }, fake)
    expect(count).toBe(prompt.length + 'user'.length)
  })

  it('a plain field named `data` beside a malformed sibling is text, not media (base64-alphabet or not)', () => {
    // Regression: `key === 'data'` alone must not trigger the media constant — a base64-looking
    // DNA/tool-input string in a `data` field is real context the model receives as text.
    const dna = 'ACGT'.repeat(30_000)
    const count = boundedBodyTokens({ messages: [null], input: { data: dna } }, fake)
    expect(count).toBe(dna.length)
  })

  it('does not throw or overflow on a pathologically deep object', () => {
    const root: Record<string, unknown> = {}
    let node = root
    for (let i = 0; i < 10_000; i++) {
      const next: Record<string, unknown> = {}
      node.next = next
      node = next
    }
    expect(() => boundedBodyTokens(root, fake)).not.toThrow()
  })
})
