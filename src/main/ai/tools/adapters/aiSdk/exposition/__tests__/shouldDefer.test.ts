import { jsonSchema, type Tool } from 'ai'
import { describe, expect, it } from 'vitest'

import type { ToolEntry } from '../../types'
import { shouldDefer } from '../shouldDefer'

function makeEntry(overrides: Partial<ToolEntry> & Pick<ToolEntry, 'name' | 'defer'>): ToolEntry {
  return {
    namespace: 'test',
    description: `${overrides.name} description`,
    tool: { description: 'tool desc', inputSchema: undefined } as unknown as Tool,
    ...overrides
  }
}

/**
 * N auto entries each with a `words`-word description (schema-free) so the pool's token
 * cost scales predictably and crosses (or not) the configured threshold.
 */
function manyAutoEntries(count: number, words: number): ToolEntry[] {
  return Array.from({ length: count }, (_, i) =>
    makeEntry({
      name: `mcp__a${i}__t`,
      defer: 'auto',
      tool: { description: 'lorem '.repeat(words), inputSchema: undefined } as unknown as Tool
    })
  )
}

describe('shouldDefer', () => {
  it('returns empty deferred set when no entries have defer policy', async () => {
    const result = await shouldDefer([makeEntry({ name: 'web_search', defer: 'never' })], 32_000)
    expect(result.deferredNames.size).toBe(0)
  })

  it('always-deferred entries are deferred regardless of token cost', async () => {
    const result = await shouldDefer([makeEntry({ name: 'experimental', defer: 'always' })], 32_000)
    expect([...result.deferredNames]).toEqual(['experimental'])
  })

  it('auto entries stay inline when total tokens fit under the 10% threshold', async () => {
    const result = await shouldDefer([makeEntry({ name: 'mcp__small__t', defer: 'auto' })], 32_000)
    expect(result.deferredNames.size).toBe(0)
    expect(result.threshold).toBe(3200)
  })

  it('auto pool below minimum count stays inline even if a single fat entry overflows the threshold', async () => {
    const result = await shouldDefer(
      [
        makeEntry({
          name: 'mcp__big__t',
          defer: 'auto',
          tool: { description: 'lorem '.repeat(10_000), inputSchema: undefined } as unknown as Tool
        })
      ],
      32_000
    )
    expect(result.deferredNames.size).toBe(0)
  })

  it('auto pool large enough AND overflowing threshold AND beating overhead defers the whole pool', async () => {
    // 5 entries × ~1500-word description ≫ 3200-token threshold, count ≥ 5, cost ≫ 500 overhead.
    const entries = manyAutoEntries(5, 1_500)
    const result = await shouldDefer(entries, 32_000)
    for (const e of entries) expect(result.deferredNames.has(e.name)).toBe(true)
  })

  it('counts the canonical inputSchema (normalized) toward the defer decision', async () => {
    // Cost lives entirely in a large JSON schema, no description — proves serializeToolSchema
    // normalizes the schema and countToolTokens counts it.
    const bigSchema = jsonSchema({
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 200 }, (_, i) => [`field_${i}`, { type: 'string', description: 'a parameter value' }])
      )
    })
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({
        name: `mcp__s${i}__t`,
        defer: 'auto',
        tool: { description: '', inputSchema: bigSchema } as unknown as Tool
      })
    )
    const result = await shouldDefer(entries, 32_000)
    for (const e of entries) expect(result.deferredNames.has(e.name)).toBe(true)
  })

  it('small-context model still gates on net-savings overhead (avoids negative-savings defer)', async () => {
    // ctx 1000 → threshold 100. 5 small entries overflow 100 but stay under the 500 overhead.
    const entries = manyAutoEntries(5, 30)
    const result = await shouldDefer(entries, 1_000)
    for (const e of entries) expect(result.deferredNames.has(e.name)).toBe(false)
  })

  it('mixed defer policies — never stays inline, always defers, auto evaluated by pool', async () => {
    const result = await shouldDefer(
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

  it('falls back to a sane default when contextWindow is undefined or zero', async () => {
    const r1 = await shouldDefer([makeEntry({ name: 'a', defer: 'auto' })], undefined)
    const r2 = await shouldDefer([makeEntry({ name: 'a', defer: 'auto' })], 0)
    expect(r1.threshold).toBe(3200)
    expect(r2.threshold).toBe(3200)
  })
})
