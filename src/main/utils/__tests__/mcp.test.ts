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
      // Input dashes are replaced, but the separator between server and tool is a dash
      expect(result).toBe('my_serv-my_tool')
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
      expect(result).toMatch(/^[\p{L}\p{N}_-]+$/u)
    })

    it('should ensure name starts with a letter or underscore', () => {
      const result = buildFunctionCallToolName('123server', '456tool')
      expect(result).toMatch(/^[\p{L}_]/u)
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

    it('should preserve serverId suffix even with long server/tool names', () => {
      const longServerName = 'a'.repeat(50)
      const longToolName = 'b'.repeat(50)
      const serverId = 'server-id-xyz789'

      const result = buildFunctionCallToolName(longServerName, longToolName, serverId)

      // The suffix should be preserved and not truncated
      expect(result).toContain('xyz789')
      expect(result.length).toBeLessThanOrEqual(63)
    })

    it('should ensure two long-named servers with different IDs produce different results', () => {
      const longServerName = 'a'.repeat(50)
      const longToolName = 'b'.repeat(50)
      const serverId1 = 'server-id-abc123'
      const serverId2 = 'server-id-def456'

      const result1 = buildFunctionCallToolName(longServerName, longToolName, serverId1)
      const result2 = buildFunctionCallToolName(longServerName, longToolName, serverId2)

      // Both should be within limit
      expect(result1.length).toBeLessThanOrEqual(63)
      expect(result2.length).toBeLessThanOrEqual(63)

      // They should be different due to preserved suffix
      expect(result1).not.toBe(result2)
    })
  })

  describe('edge cases with serverId', () => {
    it('should handle serverId with only non-alphanumeric characters', () => {
      const serverId = '------' // All dashes
      const result = buildFunctionCallToolName('server', 'tool', serverId)

      // Should still produce a valid unique suffix via fallback hash
      expect(result).toBeTruthy()
      expect(result.length).toBeLessThanOrEqual(63)
      expect(result).toMatch(/^[\p{L}_][\p{L}\p{N}_-]*$/u)
      // Should have a suffix (underscore followed by something)
      expect(result).toMatch(/_[a-z0-9]+$/)
    })

    it('should produce different results for different non-alphanumeric serverIds', () => {
      const serverId1 = '------'
      const serverId2 = '!!!!!!'

      const result1 = buildFunctionCallToolName('server', 'tool', serverId1)
      const result2 = buildFunctionCallToolName('server', 'tool', serverId2)

      // Should be different because the hash fallback produces different values
      expect(result1).not.toBe(result2)
    })

    it('should handle empty string serverId differently from undefined', () => {
      const resultWithEmpty = buildFunctionCallToolName('server', 'tool', '')
      const resultWithUndefined = buildFunctionCallToolName('server', 'tool', undefined)

      // Empty string is falsy, so both should behave the same (no suffix)
      expect(resultWithEmpty).toBe(resultWithUndefined)
    })

    it('should handle serverId with mixed alphanumeric and special chars', () => {
      const serverId = 'ab@#cd' // Mixed chars, last 6 chars contain some alphanumeric
      const result = buildFunctionCallToolName('server', 'tool', serverId)

      // Should extract alphanumeric chars: 'abcd' from 'ab@#cd'
      expect(result).toContain('abcd')
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
      expect(tool1).toMatch(/^[\p{L}_][\p{L}\p{N}_-]*$/u)
      expect(tool2).toMatch(/^[\p{L}_][\p{L}\p{N}_-]*$/u)

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

  describe('internationalization support', () => {
    it('should preserve Chinese characters in tool names', () => {
      const result = buildFunctionCallToolName('ocr', '行驶证OCR_轻盈版')
      expect(result).toContain('行驶证')
      expect(result).toContain('OCR')
      expect(result).toContain('轻盈版')
    })

    it('should distinguish between different Chinese OCR tools', () => {
      const tools = [
        buildFunctionCallToolName('ocr', '行驶证OCR_轻盈版'),
        buildFunctionCallToolName('ocr', '营业执照OCR_轻盈版'),
        buildFunctionCallToolName('ocr', '车牌OCR_轻盈版'),
        buildFunctionCallToolName('ocr', '身份证OCR')
      ]

      // All tools should be unique
      const uniqueTools = new Set(tools)
      expect(uniqueTools.size).toBe(4)

      // Verify each tool contains its distinctive Chinese characters
      expect(tools[0]).toContain('行驶证')
      expect(tools[1]).toContain('营业执照')
      expect(tools[2]).toContain('车牌')
      expect(tools[3]).toContain('身份证')
    })

    it('should handle Japanese characters', () => {
      const result = buildFunctionCallToolName('server', 'ユーザー検索')
      expect(result).toContain('ユーザー検索')
      expect(result).toMatch(/^[\p{L}_][\p{L}\p{N}_-]*$/u)
    })

    it('should handle Korean characters', () => {
      const result = buildFunctionCallToolName('server', '사용자검색')
      expect(result).toContain('사용자검색')
      expect(result).toMatch(/^[\p{L}_][\p{L}\p{N}_-]*$/u)
    })

    it('should handle mixed language tool names', () => {
      const result = buildFunctionCallToolName('api', 'search用户by名称')
      expect(result).toContain('search')
      expect(result).toContain('用户')
      expect(result).toContain('by')
      expect(result).toContain('名称')
      expect(result).toMatch(/^[\p{L}_][\p{L}\p{N}_-]*$/u)
    })

    it('should replace only control characters and special symbols, not Unicode letters', () => {
      const result = buildFunctionCallToolName('test', '文件@上传#工具')
      // @ and # should be replaced with underscores
      expect(result).not.toContain('@')
      expect(result).not.toContain('#')
      // Chinese characters should be preserved
      expect(result).toContain('文件')
      expect(result).toContain('上传')
      expect(result).toContain('工具')
    })
  })
})
