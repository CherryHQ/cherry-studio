import type { Tool } from 'ai'
import { describe, expect, it } from 'vitest'

import type { ToolEntry } from '../../types'
import { shouldDefer } from '../shouldDefer'

function makeEntry(overrides: Partial<ToolEntry> & Pick<ToolEntry, 'name' | 'defer'>): ToolEntry {
  return {
    namespace: 'test',
    description: `${overrides.name} description`,
    tool: { description: 'tool desc', inputSchema: { type: 'object' } } as unknown as Tool,
    ...overrides
  }
}

describe('shouldDefer', () => {
  it('returns empty deferred set when no entries have defer policy', () => {
    const result = shouldDefer([makeEntry({ name: 'web__search', defer: 'never' })], 32_000)
    expect(result.deferredNames.size).toBe(0)
  })

  it('always-deferred entries are deferred regardless of token cost', () => {
    const result = shouldDefer([makeEntry({ name: 'experimental', defer: 'always' })], 32_000)
    expect([...result.deferredNames]).toEqual(['experimental'])
  })

  it('auto entries stay inline when total tokens fit under the 10% threshold', () => {
    // Tiny entry → minimal token cost → well under 10% of 32k = 3200
    const result = shouldDefer([makeEntry({ name: 'mcp__small__t', defer: 'auto' })], 32_000)
    expect(result.deferredNames.size).toBe(0)
    expect(result.threshold).toBe(3200)
    expect(result.autoTokens).toBeLessThan(3200)
  })

  it('auto entries flip to deferred when the pool exceeds the threshold', () => {
    // Build a fat description so a single auto entry breaches the threshold.
    const huge = 'x'.repeat(50_000)
    const result = shouldDefer(
      [
        makeEntry({
          name: 'mcp__big__t',
          defer: 'auto',
          tool: { description: huge, inputSchema: {} } as unknown as Tool
        })
      ],
      32_000
    )
    expect(result.deferredNames.has('mcp__big__t')).toBe(true)
    expect(result.autoTokens).toBeGreaterThan(result.threshold)
  })

  it('mixed defer policies — never stays inline, always defers, auto evaluated by pool', () => {
    const result = shouldDefer(
      [
        makeEntry({ name: 'web__search', defer: 'never' }),
        makeEntry({ name: 'kb__search', defer: 'never' }),
        makeEntry({ name: 'experimental', defer: 'always' }),
        makeEntry({ name: 'mcp__a__t', defer: 'auto' }),
        makeEntry({ name: 'mcp__b__t', defer: 'auto' })
      ],
      32_000
    )
    expect(result.deferredNames.has('web__search')).toBe(false)
    expect(result.deferredNames.has('kb__search')).toBe(false)
    expect(result.deferredNames.has('experimental')).toBe(true)
    // auto entries depend on token cost; with tiny descriptions they stay inline
    expect(result.deferredNames.has('mcp__a__t')).toBe(false)
    expect(result.deferredNames.has('mcp__b__t')).toBe(false)
  })

  it('falls back to a sane default when contextWindow is undefined or zero', () => {
    const r1 = shouldDefer([makeEntry({ name: 'a', defer: 'auto' })], undefined)
    const r2 = shouldDefer([makeEntry({ name: 'a', defer: 'auto' })], 0)
    // 32_000 fallback × 10% = 3200
    expect(r1.threshold).toBe(3200)
    expect(r2.threshold).toBe(3200)
  })
})
