import type { TextTokenizer } from '@main/ai/tokens/textTokenizer'
import { describe, expect, it } from 'vitest'

import { boundedBodyTokens } from '../fallbackEstimate'

const fake: TextTokenizer = { id: 'fake', count: (t) => t.length }

describe('boundedBodyTokens', () => {
  it('sums the lengths of short strings across nested arrays/objects', () => {
    expect(boundedBodyTokens({ a: 'hi', b: ['x', 'yz'] }, fake)).toBe('hi'.length + 'x'.length + 'yz'.length)
  })

  it('prices base64 media under a `data` key and data URLs as a small constant, never their length', () => {
    const big = 'A'.repeat(1_000_000)
    const block = { source: { type: 'base64', media_type: 'image/png', data: big } }
    expect(boundedBodyTokens(block, fake)).toBe(1_500 + 'base64'.length + 'image/png'.length)
    expect(boundedBodyTokens({ url: `data:image/png;base64,${big}` }, fake)).toBe(1_500)
  })

  it('estimates a long ordinary text prompt as text via sample extrapolation, not one media constant', () => {
    // A 100k+ char prompt through the fallback must not report ~1500 tokens — that would
    // defer client compaction until the downstream context limit is hit.
    const prompt = 'lorem ipsum dolor sit amet '.repeat(5_000)
    const count = boundedBodyTokens({ messages: [{ role: 'user', content: prompt }] }, fake)
    expect(count).toBe(prompt.length + 'user'.length)
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
