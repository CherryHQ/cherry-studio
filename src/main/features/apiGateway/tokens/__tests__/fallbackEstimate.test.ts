import type { TextTokenizer } from '@main/ai/tokens/textTokenizer'
import { describe, expect, it } from 'vitest'

import { boundedBodyTokens } from '../fallbackEstimate'

const fake: TextTokenizer = { id: 'fake', count: (t) => t.length }

describe('boundedBodyTokens', () => {
  it('sums the lengths of short strings across nested arrays/objects', () => {
    expect(boundedBodyTokens({ a: 'hi', b: ['x', 'yz'] }, fake)).toBe('hi'.length + 'x'.length + 'yz'.length)
  })

  it('prices an oversize (media base64) string as a small constant, never its full length', () => {
    const big = 'A'.repeat(1_000_000)
    const count = boundedBodyTokens({ image: big }, fake)
    expect(count).toBe(1500)
    expect(count).toBeLessThan(big.length / 100)
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
