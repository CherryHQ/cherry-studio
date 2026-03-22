import { describe, expect, it } from 'vitest'

import type { ToolIdentity, ToolNameMapping } from '../toolname'
import { buildHubJsToolName, buildToolNameMapping, isNamespacedToolId, resolveToolId } from '../toolname'

describe('toolname', () => {
  describe('isNamespacedToolId', () => {
    it('returns true for namespaced ids', () => {
      expect(isNamespacedToolId('github__search_repos')).toBe(true)
      expect(isNamespacedToolId('db__query')).toBe(true)
    })

    it('returns false for JS names', () => {
      expect(isNamespacedToolId('githubSearchRepos')).toBe(false)
      expect(isNamespacedToolId('query')).toBe(false)
    })
  })

  describe('buildHubJsToolName', () => {
    it('combines server and tool names in camelCase', () => {
      expect(buildHubJsToolName('GitHub', 'search_repos')).toBe('githubSearchRepos')
    })

    it('handles empty server name', () => {
      expect(buildHubJsToolName(undefined, 'search_repos')).toBe('searchRepos')
      expect(buildHubJsToolName('', 'search_repos')).toBe('searchRepos')
    })
  })

  describe('buildToolNameMapping', () => {
    const tools: ToolIdentity[] = [
      { id: 'github__search_repos', serverName: 'GitHub', toolName: 'search_repos' },
      { id: 'github__get_user', serverName: 'GitHub', toolName: 'get_user' },
      { id: 'database__query', serverName: 'Database', toolName: 'query' }
    ]

    it('builds bidirectional mapping', () => {
      const mapping = buildToolNameMapping(tools)

      expect(mapping.toJs.get('github__search_repos')).toBe('githubSearchRepos')
      expect(mapping.toJs.get('github__get_user')).toBe('githubGetUser')
      expect(mapping.toJs.get('database__query')).toBe('databaseQuery')

      expect(mapping.toOriginal.get('githubSearchRepos')).toBe('github__search_repos')
      expect(mapping.toOriginal.get('githubGetUser')).toBe('github__get_user')
      expect(mapping.toOriginal.get('databaseQuery')).toBe('database__query')
    })

    it('handles name collisions with suffix', () => {
      const collisionTools: ToolIdentity[] = [
        { id: 'a__search', serverName: 'GitHub', toolName: 'search' },
        { id: 'b__search', serverName: 'GitHub', toolName: 'search' }
      ]

      const mapping = buildToolNameMapping(collisionTools)
      const jsNames = [...mapping.toOriginal.keys()]

      expect(jsNames).toContain('githubSearch')
      expect(jsNames).toContain('githubSearch_2')
    })

    it('handles empty input', () => {
      const mapping = buildToolNameMapping([])
      expect(mapping.toJs.size).toBe(0)
      expect(mapping.toOriginal.size).toBe(0)
    })
  })

  describe('resolveToolId', () => {
    let mapping: ToolNameMapping

    beforeAll(() => {
      mapping = buildToolNameMapping([
        { id: 'github__search_repos', serverName: 'GitHub', toolName: 'search_repos' },
        { id: 'database__query', serverName: 'Database', toolName: 'query' }
      ])
    })

    it('returns namespaced id as-is', () => {
      expect(resolveToolId(mapping, 'github__search_repos')).toBe('github__search_repos')
      expect(resolveToolId(mapping, 'unknown__tool')).toBe('unknown__tool')
    })

    it('resolves JS name to namespaced id', () => {
      expect(resolveToolId(mapping, 'githubSearchRepos')).toBe('github__search_repos')
      expect(resolveToolId(mapping, 'databaseQuery')).toBe('database__query')
    })

    it('returns undefined for unknown JS name', () => {
      expect(resolveToolId(mapping, 'unknownTool')).toBeUndefined()
    })

    it('returns undefined for empty input', () => {
      expect(resolveToolId(mapping, '')).toBeUndefined()
    })
  })
})
