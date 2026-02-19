/**
 * PromptToolUsePlugin Tests
 * Tests for prompt-based tool use plugin functionality
 */

import type { ToolSet } from 'ai'
import { beforeEach, describe, expect, it } from 'vitest'

import type { AiRequestContext } from '../../../types'
import { createPromptToolUsePlugin, DEFAULT_SYSTEM_PROMPT } from '../promptToolUsePlugin'

describe('createPromptToolUsePlugin', () => {
  let mockContext: AiRequestContext

  // Create a mock ToolSet that matches the expected structure
  const mockTools = {
    test_tool: {
      type: 'function',
      description: 'A test tool',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query']
      }
    }
  } as unknown as ToolSet

  beforeEach(() => {
    mockContext = {
      model: 'test-model',
      isRecursiveCall: false
    } as AiRequestContext
  })

  describe('transformParams', () => {
    it('should build system prompt with tool definitions on first call', () => {
      const plugin = createPromptToolUsePlugin({ enabled: true })

      const params = {
        system: 'User system prompt',
        tools: mockTools,
        messages: []
      }

      const result = plugin.transformParams!(params, mockContext) as Record<string, unknown>

      // System prompt should contain tool definitions
      expect(result.system).toContain('In this environment you have access to a set of tools')
      expect(result.system).toContain('test_tool')
      expect(result.system).toContain('A test tool')
      expect(result.system).toContain('User system prompt')

      // Tools should be removed from params (converted to prompt mode)
      expect(result.tools).toBeUndefined()

      // mcpTools should be saved in context
      expect(mockContext.mcpTools).toBeDefined()
      expect(mockContext.mcpTools!.test_tool).toBeDefined()
    })

    it('should NOT rebuild system prompt on recursive call (fix for issue #12638)', () => {
      const plugin = createPromptToolUsePlugin({ enabled: true })

      // First call: build the system prompt with tools
      const firstParams = {
        system: 'User system prompt',
        tools: mockTools,
        messages: []
      }

      const firstResult = plugin.transformParams!(firstParams, mockContext) as Record<string, unknown>
      const firstSystemPrompt = firstResult.system as string

      // Verify first call includes tool definitions
      expect(firstSystemPrompt).toContain('test_tool')

      // Simulate recursive call: isRecursiveCall is true
      // The system prompt already contains tool definitions from first call
      mockContext.isRecursiveCall = true

      const recursiveParams = {
        system: firstSystemPrompt, // Already contains tool definitions
        tools: mockTools,
        messages: []
      }

      const recursiveResult = plugin.transformParams!(recursiveParams, mockContext) as Record<string, unknown>

      // System prompt should NOT be rebuilt - it should remain the same
      // This prevents duplicate tool definitions
      expect(recursiveResult.system).toBe(firstSystemPrompt)

      // Count occurrences of tool definition to ensure no duplication
      const toolOccurrences = (recursiveResult.system as string).split('test_tool').length - 1
      const firstToolOccurrences = firstSystemPrompt.split('test_tool').length - 1
      expect(toolOccurrences).toBe(firstToolOccurrences)
    })

    it('should return params unchanged when disabled', () => {
      const plugin = createPromptToolUsePlugin({ enabled: false })

      const params = {
        system: 'User system prompt',
        tools: mockTools,
        messages: []
      }

      const result = plugin.transformParams!(params, mockContext)

      expect(result).toBe(params)
    })

    it('should return params unchanged when no tools provided', () => {
      const plugin = createPromptToolUsePlugin({ enabled: true })

      const params = {
        system: 'User system prompt',
        messages: []
      }

      const result = plugin.transformParams!(params, mockContext)

      expect(result).toBe(params)
    })

    it('should preserve provider-defined tools in params', () => {
      const plugin = createPromptToolUsePlugin({ enabled: true })

      const mixedTools = {
        ...mockTools,
        provider_tool: {
          type: 'provider-defined' as const,
          id: 'provider_tool',
          args: {}
        }
      } as unknown as ToolSet

      const params = {
        system: 'User system prompt',
        tools: mixedTools,
        messages: []
      }

      const result = plugin.transformParams!(params, mockContext) as Record<string, unknown>
      const resultTools = result.tools as ToolSet | undefined

      // Provider-defined tools should remain in params.tools
      expect(resultTools).toBeDefined()
      expect(resultTools!.provider_tool).toBeDefined()

      // Regular tools should be converted to prompt mode
      expect(resultTools!.test_tool).toBeUndefined()
      expect(mockContext.mcpTools!.test_tool).toBeDefined()
    })

    it('should set originalParams in context', () => {
      const plugin = createPromptToolUsePlugin({ enabled: true })

      const params = {
        system: 'User system prompt',
        tools: mockTools,
        messages: []
      }

      plugin.transformParams!(params, mockContext)

      expect(mockContext.originalParams).toBeDefined()
      expect(mockContext.originalParams.system).toContain('test_tool')
    })
  })

  describe('DEFAULT_SYSTEM_PROMPT', () => {
    it('should contain required sections', () => {
      expect(DEFAULT_SYSTEM_PROMPT).toContain('Tool Use Formatting')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('<tool_use>')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('Tool Use Rules')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('{{ TOOLS_INFO }}')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('{{ USER_SYSTEM_PROMPT }}')
    })
  })
})
