import type { Tool } from 'ai'
import { describe, expect, it } from 'vitest'

import { ToolRegistry } from '../registry'
import type { ToolEntry } from '../types'

function makeEntry(overrides: Partial<ToolEntry> & Pick<ToolEntry, 'name'>): ToolEntry {
  return {
    namespace: 'test',
    description: `${overrides.name} description`,
    defer: 'never',
    tool: { description: '' } as unknown as Tool,
    ...overrides
  }
}

describe('ToolRegistry', () => {
  describe('register / deregister', () => {
    it('stores and retrieves an entry by name', () => {
      const reg = new ToolRegistry()
      const entry = makeEntry({ name: 'web__search' })
      reg.register(entry)
      expect(reg.getByName('web__search')).toBe(entry)
      expect(reg.has('web__search')).toBe(true)
    })

    it('replaces an existing entry on duplicate register', () => {
      const reg = new ToolRegistry()
      const v1 = makeEntry({ name: 'mcp__gh__search', description: 'v1' })
      const v2 = makeEntry({ name: 'mcp__gh__search', description: 'v2' })
      reg.register(v1)
      reg.register(v2)
      expect(reg.getByName('mcp__gh__search')?.description).toBe('v2')
      expect(reg.getAll().length).toBe(1)
    })

    it('deregister removes the entry and reports whether it existed', () => {
      const reg = new ToolRegistry()
      reg.register(makeEntry({ name: 'kb__search' }))
      expect(reg.deregister('kb__search')).toBe(true)
      expect(reg.deregister('kb__search')).toBe(false)
      expect(reg.has('kb__search')).toBe(false)
    })
  })

  describe('getAll filter', () => {
    function withSeed(): ToolRegistry {
      const reg = new ToolRegistry()
      reg.register(makeEntry({ name: 'web__search', namespace: 'web', description: 'Search the web' }))
      reg.register(makeEntry({ name: 'web__fetch', namespace: 'web', description: 'Read URLs' }))
      reg.register(makeEntry({ name: 'kb__search', namespace: 'kb', description: 'Search documents' }))
      reg.register(
        makeEntry({
          name: 'mcp__gh__search_repos',
          namespace: 'mcp:gh',
          description: 'Search GitHub repos'
        })
      )
      return reg
    }

    it('returns all entries when filter is empty', () => {
      expect(withSeed().getAll().length).toBe(4)
    })

    it('filters by exact namespace', () => {
      const list = withSeed().getAll({ namespace: 'web' })
      expect(list.map((e) => e.name).sort()).toEqual(['web__fetch', 'web__search'])
    })

    it('matches query against name, description, and namespace (case-insensitive)', () => {
      const reg = withSeed()
      // name match
      expect(reg.getAll({ query: 'fetch' }).map((e) => e.name)).toEqual(['web__fetch'])
      // description match
      expect(reg.getAll({ query: 'github' }).map((e) => e.name)).toEqual(['mcp__gh__search_repos'])
      // namespace match
      expect(reg.getAll({ query: 'kb' }).map((e) => e.name)).toEqual(['kb__search'])
    })

    it('AND-combines multiple filter fields', () => {
      const list = withSeed().getAll({ namespace: 'web', query: 'search' })
      expect(list.map((e) => e.name)).toEqual(['web__search'])
    })
  })

  describe('getByNamespace', () => {
    it('groups entries by namespace, preserving insertion order within each group', () => {
      const reg = new ToolRegistry()
      reg.register(makeEntry({ name: 'web__search', namespace: 'web' }))
      reg.register(makeEntry({ name: 'kb__search', namespace: 'kb' }))
      reg.register(makeEntry({ name: 'web__fetch', namespace: 'web' }))

      const grouped = reg.getByNamespace()
      expect([...grouped.keys()].sort()).toEqual(['kb', 'web'])
      expect(grouped.get('web')!.map((e) => e.name)).toEqual(['web__search', 'web__fetch'])
      expect(grouped.get('kb')!.map((e) => e.name)).toEqual(['kb__search'])
    })

    it('forwards filter to underlying getAll', () => {
      const reg = new ToolRegistry()
      reg.register(makeEntry({ name: 'web__search', namespace: 'web' }))
      reg.register(makeEntry({ name: 'mcp__gh__x', namespace: 'mcp:gh' }))

      const grouped = reg.getByNamespace({ namespace: 'mcp:gh' })
      expect([...grouped.keys()]).toEqual(['mcp:gh'])
    })
  })

  describe('isAvailable', () => {
    it('returns true when no isAvailable hook is defined', async () => {
      const reg = new ToolRegistry()
      const entry = makeEntry({ name: 'web__search' })
      expect(await reg.isAvailable(entry)).toBe(true)
    })

    it('returns false only on explicit false', async () => {
      const reg = new ToolRegistry()
      const blocked = makeEntry({ name: 'a', isAvailable: () => false })
      const ok = makeEntry({ name: 'b', isAvailable: () => true })
      const asyncOk = makeEntry({ name: 'c', isAvailable: async () => true })
      expect(await reg.isAvailable(blocked)).toBe(false)
      expect(await reg.isAvailable(ok)).toBe(true)
      expect(await reg.isAvailable(asyncOk)).toBe(true)
    })

    it('treats a thrown check as available — fail-open', async () => {
      const reg = new ToolRegistry()
      const entry = makeEntry({
        name: 'flaky',
        isAvailable: () => {
          throw new Error('network down')
        }
      })
      expect(await reg.isAvailable(entry)).toBe(true)
    })
  })
})
