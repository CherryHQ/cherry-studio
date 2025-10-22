import { describe, expect, it } from 'vitest'

import { buildFunctionCallToolName } from '../mcp'

describe('buildFunctionCallToolName', () => {
  describe('basic functionality', () => {
    it('should combine server name and tool name', () => {
      const result = buildFunctionCallToolName('github', 'search_issues')
      expect(result).toContain('github')
      expect(result).toContain('search')
    })

    it('should sanitize names by replacing dashes with underscores', () => {
      const result = buildFunctionCallToolName('my-server', 'my-tool')
      expect(result).not.toContain('-')
      expect(result).toContain('_')
    })

    it('should handle empty server names gracefully', () => {
      const result = buildFunctionCallToolName('', 'tool')
      expect(result).toBeTruthy()
    })
  })

  describe('uniqueness with serverId', () => {
    it('should generate different IDs for same server name but different serverIds', () => {
      const serverId1 = 'server-id-123456'
      const serverId2 = 'server-id-789012'
      const serverName = 'github'
      const toolName = 'search_repos'

      const result1 = buildFunctionCallToolName(serverName, toolName, serverId1)
      const result2 = buildFunctionCallToolName(serverName, toolName, serverId2)

      expect(result1).not.toBe(result2)
      expect(result1).toContain('123456')
      expect(result2).toContain('789012')
    })

    it('should generate same ID when serverId is not provided', () => {
      const serverName = 'github'
      const toolName = 'search_repos'

      const result1 = buildFunctionCallToolName(serverName, toolName)
      const result2 = buildFunctionCallToolName(serverName, toolName)

      expect(result1).toBe(result2)
    })

    it('should include serverId suffix when provided', () => {
      const serverId = 'abc123def456'
      const result = buildFunctionCallToolName('server', 'tool', serverId)
      
      // Should include last 6 chars of serverId
      expect(result).toContain('ef456')
    })
  })

  describe('character sanitization', () => {
    it('should replace invalid characters with underscores', () => {
      const result = buildFunctionCallToolName('test@server', 'tool#name')
      expect(result).not.toMatch(/[@#]/)
      expect(result).toMatch(/^[a-zA-Z0-9_-]+$/)
    })

    it('should ensure name starts with a letter', () => {
      const result = buildFunctionCallToolName('123server', '456tool')
      expect(result).toMatch(/^[a-zA-Z]/)
    })

    it('should handle consecutive underscores/dashes', () => {
      const result = buildFunctionCallToolName('my--server', 'my__tool')
      expect(result).not.toMatch(/[_-]{2,}/)
    })
  })

  describe('length constraints', () => {
    it('should truncate names longer than 63 characters', () => {
      const longServerName = 'a'.repeat(50)
      const longToolName = 'b'.repeat(50)
      const result = buildFunctionCallToolName(longServerName, longToolName, 'id123456')
      
      expect(result.length).toBeLessThanOrEqual(63)
    })

    it('should not end with underscore or dash after truncation', () => {
      const longServerName = 'a'.repeat(50)
      const longToolName = 'b'.repeat(50)
      const result = buildFunctionCallToolName(longServerName, longToolName, 'id123456')
      
      expect(result).not.toMatch(/[_-]$/)
    })
  })

  describe('real-world scenarios', () => {
    it('should handle GitHub MCP server instances correctly', () => {
      const serverName = 'github'
      const toolName = 'search_repositories'
      
      const githubComId = 'server-github-com-abc123'
      const gheId = 'server-ghe-internal-xyz789'

      const tool1 = buildFunctionCallToolName(serverName, toolName, githubComId)
      const tool2 = buildFunctionCallToolName(serverName, toolName, gheId)

      // Should be different
      expect(tool1).not.toBe(tool2)
      
      // Both should be valid identifiers
      expect(tool1).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/)
      expect(tool2).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/)
      
      // Both should be <= 63 chars
      expect(tool1.length).toBeLessThanOrEqual(63)
      expect(tool2.length).toBeLessThanOrEqual(63)
    })

    it('should handle tool names that already include server name prefix', () => {
      const result = buildFunctionCallToolName('github', 'github_search_repos')
      expect(result).toBeTruthy()
      // Should not double the server name
      expect(result.split('github').length - 1).toBeLessThanOrEqual(2)
    })
  })
})
