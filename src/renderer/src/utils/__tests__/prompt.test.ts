import { MCPTool } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { AvailableTools, buildSystemPrompt } from '../prompt'

describe('prompt', () => {
  // 辅助函数：创建符合 MCPTool 类型的工具对象
  const createMcpTool = (id: string, description: string, inputSchema: any): MCPTool => ({
    id,
    description,
    inputSchema,
    serverId: 'test-server-id',
    serverName: 'test-server',
    name: id
  })

  describe('AvailableTools', () => {
    it('should generate XML format for tools', () => {
      const tools = [createMcpTool('test-tool', 'Test tool description', { type: 'object' })]
      const result = AvailableTools(tools)

      expect(result).toContain('<tools>')
      expect(result).toContain('</tools>')
      expect(result).toContain('<tool>')
      expect(result).toContain('test-tool')
      expect(result).toContain('Test tool description')
      expect(result).toContain('{"type":"object"}')
    })

    it('should handle empty tools array', () => {
      const result = AvailableTools([])

      expect(result).toContain('<tools>')
      expect(result).toContain('</tools>')
      expect(result).not.toContain('<tool>')
    })
  })

  describe('buildSystemPrompt', () => {
    it('should build prompt with tools', () => {
      const userPrompt = 'Custom user system prompt'
      const tools = [createMcpTool('test-tool', 'Test tool description', { type: 'object' })]
      const result = buildSystemPrompt(userPrompt, tools)

      expect(result).toContain(userPrompt)
      expect(result).toContain('test-tool')
      expect(result).toContain('Test tool description')
    })

    it('should return user prompt without tools', () => {
      const userPrompt = 'Custom user system prompt'
      const result = buildSystemPrompt(userPrompt, [])

      expect(result).toBe(userPrompt)
    })

    it('should handle null or undefined user prompt', () => {
      const tools = [createMcpTool('test-tool', 'Test tool description', { type: 'object' })]

      // 测试 userPrompt 为 null 的情况
      const resultNull = buildSystemPrompt(null as any, tools)
      expect(resultNull).toBeDefined()
      expect(resultNull).not.toContain('{{ USER_SYSTEM_PROMPT }}')

      // 测试 userPrompt 为 undefined 的情况
      const resultUndefined = buildSystemPrompt(undefined as any, tools)
      expect(resultUndefined).toBeDefined()
      expect(resultUndefined).not.toContain('{{ USER_SYSTEM_PROMPT }}')
    })
  })
})
