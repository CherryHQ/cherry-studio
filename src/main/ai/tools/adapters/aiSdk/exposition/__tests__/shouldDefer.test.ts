import { type Tool } from 'ai'
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

describe('shouldDefer', () => {
  it('returns empty deferred set when no entries have defer policy', async () => {
    const result = await shouldDefer([makeEntry({ name: 'web_search', defer: 'never' })], 32_000)
    expect(result.deferredNames.size).toBe(0)
  })

  it('always-deferred entries are deferred regardless of token cost', async () => {
    const result = await shouldDefer([makeEntry({ name: 'experimental', defer: 'always' })], 32_000)
    expect([...result.deferredNames]).toEqual(['experimental'])
  })

  it('honors explicit always and never policies in a mixed pool', async () => {
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
  })
})
