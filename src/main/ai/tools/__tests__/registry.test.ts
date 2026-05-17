import type { Tool } from 'ai'
import { describe, expect, it } from 'vitest'

import { ToolRegistry } from '../registry'
import type { ToolApplyScope, ToolEntry } from '../types'

const EMPTY_SCOPE: ToolApplyScope = { mcpToolIds: new Set() }

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
    it('groups entries by namespace, alphabetical within each group (cache-stable order)', () => {
      const reg = new ToolRegistry()
      // Register in a non-alphabetical order to prove sorting kicks in.
      reg.register(makeEntry({ name: 'web__search', namespace: 'web' }))
      reg.register(makeEntry({ name: 'kb__search', namespace: 'kb' }))
      reg.register(makeEntry({ name: 'web__fetch', namespace: 'web' }))

      const grouped = reg.getByNamespace()
      expect([...grouped.keys()].sort()).toEqual(['kb', 'web'])
      expect(grouped.get('web')!.map((e) => e.name)).toEqual(['web__fetch', 'web__search'])
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

  describe('selectActive', () => {
    it('includes entries with no `applies` predicate by default', () => {
      const reg = new ToolRegistry()
      reg.register(makeEntry({ name: 'always-on' }))
      expect(reg.selectActive(EMPTY_SCOPE).map((e) => e.name)).toEqual(['always-on'])
    })

    it('filters entries by their `applies` predicate', () => {
      const reg = new ToolRegistry()
      reg.register(makeEntry({ name: 'a', applies: () => true }))
      reg.register(makeEntry({ name: 'b', applies: () => false }))
      reg.register(makeEntry({ name: 'c' }))
      expect(reg.selectActive(EMPTY_SCOPE).map((e) => e.name)).toEqual(['a', 'c'])
    })

    it('passes the scope through to predicates', () => {
      const reg = new ToolRegistry()
      reg.register(
        makeEntry({
          name: 'mcp__gh__x',
          applies: (scope) => scope.mcpToolIds.has('mcp__gh__x')
        })
      )
      expect(reg.selectActive(EMPTY_SCOPE)).toEqual([])
      expect(reg.selectActive({ mcpToolIds: new Set(['mcp__gh__x']) }).map((e) => e.name)).toEqual(['mcp__gh__x'])
    })

    it('treats a thrown predicate as inactive — fail-closed', () => {
      const reg = new ToolRegistry()
      reg.register(makeEntry({ name: 'good' }))
      reg.register(
        makeEntry({
          name: 'broken',
          applies: () => {
            throw new Error('boom')
          }
        })
      )
      expect(reg.selectActive(EMPTY_SCOPE).map((e) => e.name)).toEqual(['good'])
    })

    it('returns entries in alphabetical order regardless of registration history', () => {
      // Cache-stable ordering: deregister + re-register must not shift entries
      // to the end of the iteration order.
      const reg = new ToolRegistry()
      reg.register(makeEntry({ name: 'mcp__b__t' }))
      reg.register(makeEntry({ name: 'mcp__a__t' }))
      reg.register(makeEntry({ name: 'mcp__c__t' }))
      reg.deregister('mcp__a__t')
      reg.register(makeEntry({ name: 'mcp__a__t' }))

      expect(reg.selectActive(EMPTY_SCOPE).map((e) => e.name)).toEqual(['mcp__a__t', 'mcp__b__t', 'mcp__c__t'])
    })
  })
})
