import type { MCPTool } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AvailableTools, buildSystemPrompt, containsSupportedVariables, promptVariableReplacer } from '../prompt'

// 直接 mock store，避免复杂的 hooks 依赖链
const mockStore = vi.hoisted(() => ({
  getState: vi.fn()
}))

vi.mock('@renderer/store', () => ({
  default: mockStore
}))

// Mock window.api
const mockWindowApi = {
  system: {
    getDeviceType: vi.fn().mockResolvedValue('Windows')
  },
  getAppInfo: vi.fn().mockResolvedValue({ arch: 'x64' })
}

Object.defineProperty(window, 'api', {
  value: mockWindowApi,
  configurable: true
})

describe('prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // 设置默认 mock store state
    mockStore.getState.mockReturnValue({
      settings: {
        userName: 'TestUser',
        language: 'en-US'
      },
      llm: {
        defaultModel: {
          name: 'default-model'
        }
      }
    })
  })

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
    it('should build prompt with tools', async () => {
      const userPrompt = 'Custom user system prompt'
      const tools = [
        { id: 'test-tool', description: 'Test tool description', inputSchema: { type: 'object' } } as MCPTool
      ]
      const result = await buildSystemPrompt(userPrompt, tools)

      expect(result).toContain(userPrompt)
      expect(result).toContain('test-tool')
      expect(result).toContain('Test tool description')
    })

    it('should return user prompt without tools', async () => {
      const userPrompt = 'Custom user system prompt'
      const result = await buildSystemPrompt(userPrompt, [])

      expect(result).toBe(userPrompt)
    })

    it('should handle null or undefined user prompt', async () => {
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

  describe('promptVariableReplacer', () => {
    it('should replace store-based variables', async () => {
      const prompt = 'User: {{username}}, Language: {{language}}'
      const result = await promptVariableReplacer(prompt)
      expect(result).toBe('User: TestUser, Language: en-US')
    })

    it('should replace date/time variables', async () => {
      const prompt = 'Date: {{date}}, Time: {{time}}, DateTime: {{datetime}}'
      const result = await promptVariableReplacer(prompt)

      // 验证变量被替换，而不需要检查具体格式
      expect(result).not.toContain('{{date}}')
      expect(result).not.toContain('{{time}}')
      expect(result).not.toContain('{{datetime}}')
    })

    it('should replace system info variables', async () => {
      const prompt = 'System: {{system}}, Arch: {{arch}}'
      const result = await promptVariableReplacer(prompt)

      expect(result).toBe('System: Windows, Arch: x64')
      expect(mockWindowApi.system.getDeviceType).toHaveBeenCalled()
      expect(mockWindowApi.getAppInfo).toHaveBeenCalled()
    })

    it('should handle model_name variable', async () => {
      // 测试提供 modelName 参数
      let result = await promptVariableReplacer('Model: {{model_name}}', 'gpt-4')
      expect(result).toBe('Model: gpt-4')

      // 测试使用默认 model
      result = await promptVariableReplacer('Model: {{model_name}}')
      expect(result).toBe('Model: default-model')
    })

    it('should handle multiple variables without double-processing', async () => {
      const prompt = 'User {{username}} uses {{model_name}} in {{language}}'
      const result = await promptVariableReplacer(prompt, 'gpt-4')

      expect(result).toBe('User TestUser uses gpt-4 in en-US')
      // 确保用户名只出现一次（不会重复处理）
      expect(result.split('TestUser').length - 1).toBe(1)
    })

    it('should handle fallback values', async () => {
      mockStore.getState.mockReturnValue({
        settings: { userName: '', language: 'en-US' },
        llm: { defaultModel: { name: 'default-model' } }
      })

      const result = await promptVariableReplacer('Hello {{username}}')
      expect(result).toBe('Hello User')
    })

    it('should handle edge cases', async () => {
      // 空字符串
      expect(await promptVariableReplacer('')).toBe('')

      // 无变量的文本
      const plainText = 'Plain text without variables'
      expect(await promptVariableReplacer(plainText)).toBe(plainText)
    })

    it('should handle errors gracefully', async () => {
      mockStore.getState.mockImplementation(() => {
        throw new Error('Store error')
      })

      const result = await promptVariableReplacer('Hello {{username}} and {{language}}')
      expect(result).toBe('Hello Unknown Username and Unknown System Language')
    })

    it('should handle special characters in values', async () => {
      mockStore.getState.mockReturnValue({
        settings: { userName: 'Test@User#123', language: 'en-US' },
        llm: { defaultModel: { name: 'default-model' } }
      })

      const result = await promptVariableReplacer('Hello {{username}}')
      expect(result).toBe('Hello Test@User#123')
    })
  })

  describe('containsSupportedVariables', () => {
    it('should detect supported variables', () => {
      expect(containsSupportedVariables('Hello {{username}}')).toBe(true)
      expect(containsSupportedVariables('{{username}} and {{date}}')).toBe(true)
      expect(containsSupportedVariables('Model: {{model_name}}')).toBe(true)
    })

    it('should return false for unsupported variables', () => {
      expect(containsSupportedVariables('Hello {{unsupported}}')).toBe(false)
      expect(containsSupportedVariables('Plain text')).toBe(false)
      expect(containsSupportedVariables('')).toBe(false)
    })
  })
})
