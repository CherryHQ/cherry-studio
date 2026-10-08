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
      const entry = makeEntry({ name: 'web_search' })
      reg.register(entry)
      expect(reg.getByName('web_search')).toBe(entry)
      expect(reg.has('web_search')).toBe(true)
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
      reg.register(makeEntry({ name: 'kb_search' }))
      expect(reg.deregister('kb_search')).toBe(true)
      expect(reg.deregister('kb_search')).toBe(false)
      expect(reg.has('kb_search')).toBe(false)
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

    it('materializes a request-scoped tool without mutating the registered entry', () => {
      const reg = new ToolRegistry()
      const staticTool = { description: 'static' } as unknown as Tool
      const requestTool = { description: 'request' } as unknown as Tool
      reg.register(
        makeEntry({
          name: 'dynamic',
          tool: staticTool,
          buildTool: (scope) => (scope.hasFileAttachments ? requestTool : staticTool)
        })
      )

      expect(reg.selectActive({ ...EMPTY_SCOPE, hasFileAttachments: true })[0].tool).toBe(requestTool)
      expect(reg.getByName('dynamic')?.tool).toBe(staticTool)
    })

    it('treats a thrown request-scoped builder as inactive — fail-closed', () => {
      const reg = new ToolRegistry()
      reg.register(makeEntry({ name: 'good' }))
      reg.register(
        makeEntry({
          name: 'broken',
          buildTool: () => {
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
