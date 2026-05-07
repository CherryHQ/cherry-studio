import type { Assistant } from '@shared/data/types/assistant'
import type { Tool } from 'ai'
import { describe, expect, it } from 'vitest'

import { ToolRegistry } from '../../tools/registry'
import type { ToolApplyScope, ToolEntry, ToolNamespace } from '../../tools/types'
import { computeToolSignature, ToolsetCache } from '../toolsetCache'

// ── Test fixtures ───────────────────────────────────────────────────

function makeEntry(overrides: Partial<ToolEntry> & Pick<ToolEntry, 'name'>): ToolEntry {
  return {
    namespace: 'test' as ToolNamespace,
    description: `${overrides.name} description`,
    defer: 'never',
    tool: { description: '' } as unknown as Tool,
    ...overrides
  }
}

function seededRegistry(): ToolRegistry {
  const reg = new ToolRegistry()
  // An always-on entry plus a web-search-gated entry plus an MCP-gated entry —
  // covers the three predicate flavours `applies` uses today.
  reg.register(makeEntry({ name: 'always_on' }))
  reg.register(
    makeEntry({
      name: 'web__search',
      applies: (scope) => Boolean(scope.assistant?.settings?.enableWebSearch)
    })
  )
  reg.register(
    makeEntry({
      name: 'mcp__gh__search',
      applies: (scope) => scope.mcpToolIds.has('mcp__gh__search')
    })
  )
  return reg
}

interface AssistantStub {
  id: string
  settings: { enableWebSearch: boolean }
  knowledgeBaseIds: string[]
}

const baseAssistant: AssistantStub = {
  id: 'a-1',
  settings: { enableWebSearch: false },
  knowledgeBaseIds: []
}

function scope(overrides: { assistant?: AssistantStub; mcpToolIds?: Set<string> } = {}): ToolApplyScope {
  return {
    assistant: (overrides.assistant ?? baseAssistant) as unknown as Assistant,
    mcpToolIds: overrides.mcpToolIds ?? new Set<string>()
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('computeToolSignature', () => {
  it('produces the same signature for equal scopes', () => {
    const s1 = scope()
    const s2 = scope()
    expect(computeToolSignature(s1)).toBe(computeToolSignature(s2))
  })

  it('is order-insensitive for set / array inputs', () => {
    const a = scope({
      assistant: { ...baseAssistant, knowledgeBaseIds: ['kb-2', 'kb-1'] },
      mcpToolIds: new Set(['mcp__b', 'mcp__a'])
    })
    const b = scope({
      assistant: { ...baseAssistant, knowledgeBaseIds: ['kb-1', 'kb-2'] },
      mcpToolIds: new Set(['mcp__a', 'mcp__b'])
    })
    expect(computeToolSignature(a)).toBe(computeToolSignature(b))
  })

  it('changes when web-search toggles', () => {
    const off = scope()
    const on = scope({ assistant: { ...baseAssistant, settings: { enableWebSearch: true } } })
    expect(computeToolSignature(off)).not.toBe(computeToolSignature(on))
  })

  it('changes when MCP tool ids change', () => {
    const a = scope({ mcpToolIds: new Set(['mcp__gh__search']) })
    const b = scope({ mcpToolIds: new Set(['mcp__gh__search', 'mcp__gh__issues']) })
    expect(computeToolSignature(a)).not.toBe(computeToolSignature(b))
  })

  it('changes when knowledge bases change', () => {
    const empty = scope()
    const withKb = scope({ assistant: { ...baseAssistant, knowledgeBaseIds: ['kb-1'] } })
    expect(computeToolSignature(empty)).not.toBe(computeToolSignature(withKb))
  })
})

describe('ToolsetCache', () => {
  it('returns the same ToolSet reference on repeated resolves with the same scope', () => {
    const reg = seededRegistry()
    const cache = new ToolsetCache()
    const first = cache.resolve(scope(), 'topic-1', reg)
    const second = cache.resolve(scope(), 'topic-1', reg)
    expect(second).toBe(first)
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, size: 1 })
  })

  it('rebuilds a fresh ToolSet when the scope signature changes', () => {
    const reg = seededRegistry()
    const cache = new ToolsetCache()

    const off = cache.resolve(scope(), 'topic-1', reg)
    expect(Object.keys(off).sort()).toEqual(['always_on'])

    const on = cache.resolve(
      scope({ assistant: { ...baseAssistant, settings: { enableWebSearch: true } } }),
      'topic-1',
      reg
    )
    expect(on).not.toBe(off)
    expect(Object.keys(on).sort()).toEqual(['always_on', 'web__search'])
    // Both calls were misses — first because empty, second because signature shifted.
    expect(cache.stats()).toMatchObject({ hits: 0, misses: 2, size: 1 })
  })

  it('invalidate(topicId) drops the entry so the next resolve recomputes', () => {
    const reg = seededRegistry()
    const cache = new ToolsetCache()

    const first = cache.resolve(scope(), 'topic-1', reg)
    cache.invalidate('topic-1')
    expect(cache.size()).toBe(0)

    const second = cache.resolve(scope(), 'topic-1', reg)
    // Same shape, but the underlying object is rebuilt because the cache entry was cleared.
    expect(second).not.toBe(first)
    expect(Object.keys(second)).toEqual(Object.keys(first))
  })

  it('invalidateAll() clears every entry', () => {
    const reg = seededRegistry()
    const cache = new ToolsetCache()
    cache.resolve(scope(), 'topic-1', reg)
    cache.resolve(scope(), 'topic-2', reg)
    expect(cache.size()).toBe(2)
    cache.invalidateAll()
    expect(cache.size()).toBe(0)
  })

  it('keeps independent entries for different topics', () => {
    const reg = seededRegistry()
    const cache = new ToolsetCache()

    const t1 = cache.resolve(scope(), 'topic-1', reg)
    const t2 = cache.resolve(
      scope({ assistant: { ...baseAssistant, settings: { enableWebSearch: true } } }),
      'topic-2',
      reg
    )

    expect(t1).not.toBe(t2)
    expect(Object.keys(t1)).toEqual(['always_on'])
    expect(Object.keys(t2).sort()).toEqual(['always_on', 'web__search'])

    // A second resolve on each topic still hits its own cached entry.
    expect(cache.resolve(scope(), 'topic-1', reg)).toBe(t1)
    expect(
      cache.resolve(scope({ assistant: { ...baseAssistant, settings: { enableWebSearch: true } } }), 'topic-2', reg)
    ).toBe(t2)
    expect(cache.stats()).toMatchObject({ hits: 2, misses: 2, size: 2 })
  })

  it('bypasses the cache when topicId is undefined', () => {
    const reg = seededRegistry()
    const cache = new ToolsetCache()
    const first = cache.resolve(scope(), undefined, reg)
    const second = cache.resolve(scope(), undefined, reg)
    expect(second).not.toBe(first)
    expect(cache.size()).toBe(0)
    expect(cache.stats()).toMatchObject({ hits: 0, misses: 2, size: 0 })
  })

  it('reflects current registry state by re-resolving when entries are deregistered', () => {
    const reg = seededRegistry()
    const cache = new ToolsetCache()

    cache.resolve(scope({ mcpToolIds: new Set(['mcp__gh__search']) }), 'topic-1', reg)
    // Deregister + invalidate is the contract for "registry contents shifted".
    reg.deregister('mcp__gh__search')
    cache.invalidate('topic-1')

    const after = cache.resolve(scope({ mcpToolIds: new Set(['mcp__gh__search']) }), 'topic-1', reg)
    expect(Object.keys(after).sort()).toEqual(['always_on'])
  })
})
