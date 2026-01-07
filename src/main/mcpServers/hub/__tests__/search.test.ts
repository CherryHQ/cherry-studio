import { describe, expect, it } from 'vitest'

import { searchTools } from '../search'
import type { GeneratedTool } from '../types'

const createMockTool = (partial: Partial<GeneratedTool>): GeneratedTool => {
  const functionName = partial.functionName || 'server1_tool'
  return {
    serverId: 'server1',
    serverName: 'server1',
    toolName: partial.toolName || 'tool',
    functionName,
    jsCode: `async function ${functionName}() {}`,
    fn: async () => ({}),
    signature: '{}',
    returns: 'unknown',
    ...partial
  }
}

describe('search', () => {
  describe('searchTools', () => {
    it('returns all tools when query is empty', () => {
      const tools = [
        createMockTool({ toolName: 'tool1', functionName: 'tool1' }),
        createMockTool({ toolName: 'tool2', functionName: 'tool2' })
      ]

      const result = searchTools(tools, { query: '' })

      expect(result.total).toBe(2)
      expect(result.tools).toContain('tool1')
      expect(result.tools).toContain('tool2')
    })

    it('filters tools by single keyword', () => {
      const tools = [
        createMockTool({ toolName: 'search_repos', functionName: 'searchRepos' }),
        createMockTool({ toolName: 'get_user', functionName: 'getUser' }),
        createMockTool({ toolName: 'search_users', functionName: 'searchUsers' })
      ]

      const result = searchTools(tools, { query: 'search' })

      expect(result.total).toBe(2)
      expect(result.tools).toContain('searchRepos')
      expect(result.tools).toContain('searchUsers')
      expect(result.tools).not.toContain('getUser')
    })

    it('supports OR matching with comma-separated keywords', () => {
      const tools = [
        createMockTool({ toolName: 'browser_open', functionName: 'browserOpen' }),
        createMockTool({ toolName: 'chrome_launch', functionName: 'chromeLaunch' }),
        createMockTool({ toolName: 'file_read', functionName: 'fileRead' })
      ]

      const result = searchTools(tools, { query: 'browser,chrome' })

      expect(result.total).toBe(2)
      expect(result.tools).toContain('browserOpen')
      expect(result.tools).toContain('chromeLaunch')
      expect(result.tools).not.toContain('fileRead')
    })

    it('matches against description', () => {
      const tools = [
        createMockTool({
          toolName: 'launch',
          functionName: 'launch',
          description: 'Launch a browser instance'
        }),
        createMockTool({
          toolName: 'close',
          functionName: 'close',
          description: 'Close a window'
        })
      ]

      const result = searchTools(tools, { query: 'browser' })

      expect(result.total).toBe(1)
      expect(result.tools).toContain('launch')
    })

    it('respects limit parameter', () => {
      const tools = Array.from({ length: 20 }, (_, i) =>
        createMockTool({ toolName: `tool${i}`, functionName: `server1_tool${i}` })
      )

      const result = searchTools(tools, { query: 'tool', limit: 5 })

      expect(result.total).toBe(20)
      const matches = (result.tools.match(/async function server1_tool\d+/g) || []).length
      expect(matches).toBe(5)
    })

    it('is case insensitive', () => {
      const tools = [createMockTool({ toolName: 'SearchRepos', functionName: 'searchRepos' })]

      const result = searchTools(tools, { query: 'SEARCH' })

      expect(result.total).toBe(1)
    })

    it('ranks exact matches higher', () => {
      const tools = [
        createMockTool({ toolName: 'searching', functionName: 'searching' }),
        createMockTool({ toolName: 'search', functionName: 'search' }),
        createMockTool({ toolName: 'search_more', functionName: 'searchMore' })
      ]

      const result = searchTools(tools, { query: 'search', limit: 1 })

      expect(result.tools).toContain('function search(')
    })
  })
})
