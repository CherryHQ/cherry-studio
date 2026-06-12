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

/**
 * Build N auto entries each with a `descChars`-long description so the pool
 * crosses the configured threshold. Helps express "many tools, small each"
 * vs "few tools, fat each" without magic numbers in every test.
 */
function manyAutoEntries(count: number, descChars: number): ToolEntry[] {
  return Array.from({ length: count }, (_, i) =>
    makeEntry({
      name: `mcp__a${i}__t`,
      defer: 'auto',
      tool: { description: 'x'.repeat(descChars), inputSchema: {} } as unknown as Tool
    })
  )
}

describe('shouldDefer', () => {
  it('returns empty deferred set when no entries have defer policy', () => {
    const result = shouldDefer([makeEntry({ name: 'web_search', defer: 'never' })], 32_000)
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
  })

  it('auto pool below minimum count stays inline even if a single fat entry overflows the threshold', () => {
    // One huge auto entry over the 10% threshold, but only 1 entry — below
    // MIN_AUTO_DEFER_COUNT. Round-trip cost of search-then-invoke dominates.
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
    expect(result.deferredNames.size).toBe(0)
  })

  it('auto pool large enough AND overflowing threshold AND beating overhead defers the whole pool', () => {
    // 5 entries × 8000 chars desc = 40_000 chars ≈ 10_000 tokens.
    // > 3200 threshold (10% of 32k) ✓
    // > 500 overhead ✓
    // count >= 5 ✓
    const entries = manyAutoEntries(5, 8_000)
    const result = shouldDefer(entries, 32_000)
    for (const e of entries) {
      expect(result.deferredNames.has(e.name)).toBe(true)
    }
  })

  it('small-context model still gates on net-savings overhead (avoids negative-savings defer)', () => {
    // 4K context → 400 token threshold. 5 entries × 320 chars desc = 1600 chars
    // ≈ 400 tokens. Just barely meets threshold but cost ≈ overhead (~500).
    // Net savings ≤ 0 → must NOT defer.
    const entries = manyAutoEntries(5, 320)
    const result = shouldDefer(entries, 4_000)
    for (const e of entries) {
      expect(result.deferredNames.has(e.name)).toBe(false)
    }
  })

  it('mixed defer policies — never stays inline, always defers, auto evaluated by pool', () => {
    const result = shouldDefer(
      [
        makeEntry({ name: 'web_search', defer: 'never' }),
        makeEntry({ name: 'kb_search', defer: 'never' }),
        makeEntry({ name: 'experimental', defer: 'always' }),
        makeEntry({ name: 'mcp__a__t', defer: 'auto' }),
        makeEntry({ name: 'mcp__b__t', defer: 'auto' })
      ],
      32_000
    )
    expect(result.deferredNames.has('web_search')).toBe(false)
    expect(result.deferredNames.has('kb_search')).toBe(false)
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
