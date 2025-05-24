import { type MCPTool } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { AvailableTools, buildSystemPrompt } from '../prompt'

describe('prompt', () => {
  describe('AvailableTools', () => {
    it('should generate XML format for tools', () => {
      const tools = [
        { id: 'test-tool', description: 'Test tool description', inputSchema: { type: 'object' } } as MCPTool
      ]
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
      const tools = [
        { id: 'test-tool', description: 'Test tool description', inputSchema: { type: 'object' } } as MCPTool
      ]
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
      const tools = [
        { id: 'test-tool', description: 'Test tool description', inputSchema: { type: 'object' } } as MCPTool
      ]

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
