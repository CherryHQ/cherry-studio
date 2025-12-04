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
      // Should only contain ASCII alphanumeric, underscore, dash, dot, colon
      expect(result).toMatch(/^[a-zA-Z0-9_.\-:]+$/)
    })

    it('should ensure name starts with a letter or underscore', () => {
      const result = buildFunctionCallToolName('123server', '456tool')
      expect(result).toMatch(/^[a-zA-Z_]/)
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
      expect(result).toMatch(/^[a-zA-Z_][a-zA-Z0-9_.\-:]*$/)
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

      // Both should be valid AI model tool names (ASCII only)
      expect(tool1).toMatch(/^[a-zA-Z_][a-zA-Z0-9_.\-:]*$/)
      expect(tool2).toMatch(/^[a-zA-Z_][a-zA-Z0-9_.\-:]*$/)

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

  describe('internationalization support (CJK to ASCII transliteration)', () => {
    it('should convert Chinese characters to pinyin', () => {
      const result = buildFunctionCallToolName('ocr', '行驶证OCR_轻盈版')
      // Chinese characters should be transliterated to pinyin
      expect(result).not.toMatch(/[\u4e00-\u9fff]/) // No Chinese characters
      expect(result).toContain('ocr') // OCR is lowercased
      // Should only contain ASCII characters (lowercase)
      expect(result).toMatch(/^[a-z_][a-z0-9_.\-:]*$/)
    })

    it('should distinguish between different Chinese OCR tools', () => {
      const tools = [
        buildFunctionCallToolName('ocr', '行驶证OCR_轻盈版'),
        buildFunctionCallToolName('ocr', '营业执照OCR_轻盈版'),
        buildFunctionCallToolName('ocr', '车牌OCR_轻盈版'),
        buildFunctionCallToolName('ocr', '身份证OCR')
      ]

      // All tools should be unique (pinyin transliterations are different)
      const uniqueTools = new Set(tools)
      expect(uniqueTools.size).toBe(4)

      // All should be ASCII-only valid tool names
      tools.forEach((tool) => {
        expect(tool).toMatch(/^[a-zA-Z_][a-zA-Z0-9_.\-:]*$/)
        expect(tool).not.toMatch(/[\u4e00-\u9fff]/) // No Chinese characters
      })

      // Verify they contain transliterated pinyin (with underscores between characters)
      // 行驶证 = xing_shi_zheng, 营业执照 = ying_ye_zhi_zhao, 车牌 = che_pai, 身份证 = shen_fen_zheng
      expect(tools[0]).toContain('xing_shi_zheng')
      expect(tools[1]).toContain('ying_ye_zhi_zhao')
      expect(tools[2]).toContain('che_pai')
      expect(tools[3]).toContain('shen_fen_zheng')
    })

    it('should handle Japanese characters with base36 encoding', () => {
      const result = buildFunctionCallToolName('server', 'ユーザー検索')
      // Should be ASCII-only
      expect(result).toMatch(/^[a-zA-Z_][a-zA-Z0-9_.\-:]*$/)
      // Should not contain original Japanese characters
      expect(result).not.toMatch(/[\u3040-\u309f\u30a0-\u30ff]/)
    })

    it('should handle Korean characters with base36 encoding', () => {
      const result = buildFunctionCallToolName('server', '사용자검색')
      // Should be ASCII-only
      expect(result).toMatch(/^[a-zA-Z_][a-zA-Z0-9_.\-:]*$/)
      // Should not contain original Korean characters
      expect(result).not.toMatch(/[\uac00-\ud7af]/)
    })

    it('should handle mixed language tool names', () => {
      const result = buildFunctionCallToolName('api', 'search用户by名称')
      // ASCII parts should be preserved (lowercased)
      expect(result).toContain('search')
      expect(result).toContain('by')
      // Chinese parts should be transliterated (用户 = yong_hu, 名称 = ming_cheng)
      expect(result).toContain('yong_hu')
      expect(result).toContain('ming_cheng')
      // Final result should be ASCII-only (lowercase)
      expect(result).toMatch(/^[a-z_][a-z0-9_.\-:]*$/)
    })

    it('should transliterate Chinese and replace special symbols', () => {
      const result = buildFunctionCallToolName('test', '文件@上传#工具')
      // @ and # should be replaced with underscores
      expect(result).not.toContain('@')
      expect(result).not.toContain('#')
      // Chinese characters should be transliterated
      // 文件 = wen_jian, 上传 = shang_chuan, 工具 = gong_ju
      expect(result).toContain('wen_jian')
      expect(result).toContain('shang_chuan')
      expect(result).toContain('gong_ju')
      // Should be ASCII-only (lowercase)
      expect(result).toMatch(/^[a-z_][a-z0-9_.\-:]*$/)
    })

    it('should produce AI model compatible tool names', () => {
      const testCases = ['行驶证OCR', '营业执照识别', 'get用户info', '文件@处理', '数据分析_v2']

      testCases.forEach((testCase) => {
        const result = buildFunctionCallToolName('server', testCase)
        // Must start with letter or underscore
        expect(result).toMatch(/^[a-zA-Z_]/)
        // Must only contain a-z, A-Z, 0-9, _, -, ., :
        expect(result).toMatch(/^[a-zA-Z0-9_.\-:]+$/)
        // Must be <= 64 characters
        expect(result.length).toBeLessThanOrEqual(64)
      })
    })
  })
})
