import { describe, expect, it } from 'vitest'

import { buildFunctionCallToolName } from '../mcp'

describe('buildFunctionCallToolName', () => {
  describe('basic format', () => {
    it('should return format mcp__{server}__{tool}', () => {
      const result = buildFunctionCallToolName('github', 'search_issues')
      expect(result).toBe('mcp__github__search_issues')
    })

    it('should handle simple server and tool names', () => {
      expect(buildFunctionCallToolName('fetch', 'get_page')).toBe('mcp__fetch__get_page')
      expect(buildFunctionCallToolName('database', 'query')).toBe('mcp__database__query')
      expect(buildFunctionCallToolName('cherry_studio', 'search')).toBe('mcp__cherry_studio__search')
    })
  })

  describe('valid JavaScript identifier', () => {
    it('should always start with mcp__ prefix (valid JS identifier start)', () => {
      const result = buildFunctionCallToolName('123server', '456tool')
      expect(result).toMatch(/^mcp__/)
      expect(result).toBe('mcp__123server__456tool')
    })

    it('should only contain alphanumeric chars and underscores', () => {
      const result = buildFunctionCallToolName('my-server', 'my-tool')
      expect(result).toBe('mcp__my_server__my_tool')
      expect(result).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/)
    })

    it('should be a valid JavaScript identifier', () => {
      const testCases = [
        ['github', 'create_issue'],
        ['my-server', 'fetch-data'],
        ['test@server', 'tool#name'],
        ['server.name', 'tool.action'],
        ['123abc', 'def456']
      ]

      for (const [server, tool] of testCases) {
        const result = buildFunctionCallToolName(server, tool)
        // Valid JS identifiers match this pattern
        expect(result).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
      }
    })
  })

  describe('character sanitization', () => {
    it('should replace dashes with underscores', () => {
      const result = buildFunctionCallToolName('my-server', 'my-tool-name')
      expect(result).toBe('mcp__my_server__my_tool_name')
    })

    it('should replace special characters with underscores', () => {
      const result = buildFunctionCallToolName('test@server!', 'tool#name$')
      expect(result).toBe('mcp__test_server__tool_name')
    })

    it('should replace dots with underscores', () => {
      const result = buildFunctionCallToolName('server.name', 'tool.action')
      expect(result).toBe('mcp__server_name__tool_action')
    })

    it('should replace spaces with underscores', () => {
      const result = buildFunctionCallToolName('my server', 'my tool')
      expect(result).toBe('mcp__my_server__my_tool')
    })

    it('should collapse consecutive underscores', () => {
      const result = buildFunctionCallToolName('my--server', 'my___tool')
      expect(result).toBe('mcp__my_server__my_tool')
      expect(result).not.toMatch(/_{3,}/)
    })

    it('should trim leading and trailing underscores from parts', () => {
      const result = buildFunctionCallToolName('_server_', '_tool_')
      expect(result).toBe('mcp__server__tool')
    })

    it('should handle names with only special characters', () => {
      const result = buildFunctionCallToolName('---', '###')
      expect(result).toBe('mcp____')
    })
  })

  describe('length constraints', () => {
    it('should not exceed 63 characters', () => {
      const longServerName = 'a'.repeat(50)
      const longToolName = 'b'.repeat(50)
      const result = buildFunctionCallToolName(longServerName, longToolName)

      expect(result.length).toBeLessThanOrEqual(63)
    })

    it('should truncate server name to max 20 chars', () => {
      const longServerName = 'abcdefghijklmnopqrstuvwxyz' // 26 chars
      const result = buildFunctionCallToolName(longServerName, 'tool')

      expect(result).toBe('mcp__abcdefghijklmnopqrst__tool')
      expect(result).toContain('abcdefghijklmnopqrst') // First 20 chars
      expect(result).not.toContain('uvwxyz') // Truncated
    })

    it('should truncate tool name to max 35 chars', () => {
      const longToolName = 'a'.repeat(40)
      const result = buildFunctionCallToolName('server', longToolName)

      const expectedTool = 'a'.repeat(35)
      expect(result).toBe(`mcp__server__${expectedTool}`)
    })

    it('should not end with underscores after truncation', () => {
      // Create a name that would end with underscores after truncation
      const longServerName = 'a'.repeat(20)
      const longToolName = 'b'.repeat(35) + '___extra'
      const result = buildFunctionCallToolName(longServerName, longToolName)

      expect(result).not.toMatch(/_+$/)
      expect(result.length).toBeLessThanOrEqual(63)
    })

    it('should handle max length edge case exactly', () => {
      // mcp__ (5) + server (20) + __ (2) + tool (35) = 62 chars
      const server = 'a'.repeat(20)
      const tool = 'b'.repeat(35)
      const result = buildFunctionCallToolName(server, tool)

      expect(result.length).toBe(62)
      expect(result).toBe(`mcp__${'a'.repeat(20)}__${'b'.repeat(35)}`)
    })
  })

  describe('edge cases', () => {
    it('should handle empty server name', () => {
      const result = buildFunctionCallToolName('', 'tool')
      expect(result).toBe('mcp____tool')
    })

    it('should handle empty tool name', () => {
      const result = buildFunctionCallToolName('server', '')
      expect(result).toBe('mcp__server__')
    })

    it('should handle both empty names', () => {
      const result = buildFunctionCallToolName('', '')
      expect(result).toBe('mcp____')
    })

    it('should handle whitespace-only names', () => {
      const result = buildFunctionCallToolName('   ', '   ')
      expect(result).toBe('mcp____')
    })

    it('should trim whitespace from names', () => {
      const result = buildFunctionCallToolName('  server  ', '  tool  ')
      expect(result).toBe('mcp__server__tool')
    })

    it('should handle unicode characters', () => {
      const result = buildFunctionCallToolName('服务器', '工具')
      // Unicode chars are replaced with underscores, then collapsed
      expect(result).toMatch(/^mcp__/)
    })

    it('should handle mixed case', () => {
      const result = buildFunctionCallToolName('MyServer', 'MyTool')
      expect(result).toBe('mcp__MyServer__MyTool')
    })
  })

  describe('deterministic output', () => {
    it('should produce consistent results for same input', () => {
      const serverName = 'github'
      const toolName = 'search_repos'

      const result1 = buildFunctionCallToolName(serverName, toolName)
      const result2 = buildFunctionCallToolName(serverName, toolName)
      const result3 = buildFunctionCallToolName(serverName, toolName)

      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
    })

    it('should produce different results for different inputs', () => {
      const result1 = buildFunctionCallToolName('server1', 'tool')
      const result2 = buildFunctionCallToolName('server2', 'tool')
      const result3 = buildFunctionCallToolName('server', 'tool1')
      const result4 = buildFunctionCallToolName('server', 'tool2')

      expect(result1).not.toBe(result2)
      expect(result3).not.toBe(result4)
    })
  })

  describe('real-world scenarios', () => {
    it('should handle GitHub MCP server', () => {
      expect(buildFunctionCallToolName('github', 'create_issue')).toBe('mcp__github__create_issue')
      expect(buildFunctionCallToolName('github', 'search_repositories')).toBe('mcp__github__search_repositories')
      expect(buildFunctionCallToolName('github', 'get_pull_request')).toBe('mcp__github__get_pull_request')
    })

    it('should handle filesystem MCP server', () => {
      expect(buildFunctionCallToolName('filesystem', 'read_file')).toBe('mcp__filesystem__read_file')
      expect(buildFunctionCallToolName('filesystem', 'write_file')).toBe('mcp__filesystem__write_file')
      expect(buildFunctionCallToolName('filesystem', 'list_directory')).toBe('mcp__filesystem__list_directory')
    })

    it('should handle hyphenated server names (common in npm packages)', () => {
      expect(buildFunctionCallToolName('cherry-fetch', 'get_page')).toBe('mcp__cherry_fetch__get_page')
      expect(buildFunctionCallToolName('mcp-server-github', 'search')).toBe('mcp__mcp_server_github__search')
    })

    it('should handle scoped npm package style names', () => {
      const result = buildFunctionCallToolName('@anthropic/mcp-server', 'chat')
      expect(result).toBe('mcp__anthropic_mcp_server__chat')
    })

    it('should handle tools with long descriptive names', () => {
      const result = buildFunctionCallToolName('github', 'search_repositories_by_language_and_stars')
      expect(result.length).toBeLessThanOrEqual(63)
      expect(result).toMatch(/^mcp__github__search_repositories_by_lan/)
    })
  })
})
