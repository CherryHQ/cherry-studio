import { describe, expect, it } from 'vitest'

import type { AiRequestContext } from '../../../types'
import { BuiltinToolStreamManager } from '../BuiltinToolStreamManager'

type TestBuiltinContext = {
  builtinTools?: unknown
  logger?: (level: string, message: string, data?: Record<string, unknown>) => void
}

function toAiRequestContext(context: TestBuiltinContext): AiRequestContext {
  return context as unknown as AiRequestContext
}

describe('BuiltinToolStreamManager', () => {
  describe('isBuiltinToolCall', () => {
    it('should return true for builtin tools', () => {
      const manager = new BuiltinToolStreamManager()
      const context = toAiRequestContext({
        builtinTools: {
          $web_search: {
            type: 'provider',
            toolType: 'builtin_function',
            isBuiltin: true,
            definition: { type: 'builtin_function', function: { name: '$web_search' } }
          }
        }
      })

      expect(manager.isBuiltinToolCall('$web_search', context)).toBe(true)
    })

    it('should return false for non-builtin tools', () => {
      const manager = new BuiltinToolStreamManager()
      const context = toAiRequestContext({
        builtinTools: {}
      })

      expect(manager.isBuiltinToolCall('$web_search', context)).toBe(false)
    })
  })

  describe('extractToolCallsFromChunk', () => {
    it('should extract tool calls from chunk', () => {
      const manager = new BuiltinToolStreamManager()
      const chunk = {
        toolCalls: [
          {
            id: 'call_123',
            function: { name: '$web_search', arguments: '{}' }
          }
        ]
      }

      const result = manager.extractToolCallsFromChunk(chunk)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'call_123',
        name: '$web_search',
        arguments: {},
        rawArguments: '{}'
      })
    })

    it('should handle tool_calls format', () => {
      const manager = new BuiltinToolStreamManager()
      const chunk = {
        tool_calls: [
          {
            id: 'call_456',
            name: '$web_search',
            arguments: { query: 'test' }
          }
        ]
      }

      const result = manager.extractToolCallsFromChunk(chunk)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'call_456',
        name: '$web_search',
        arguments: { query: 'test' }
      })
    })

    it('should handle invalid JSON arguments without throwing', () => {
      const manager = new BuiltinToolStreamManager()
      const chunk = {
        toolCalls: [
          {
            id: 'call_invalid',
            function: { name: '$web_search', arguments: '{"search_result":' }
          }
        ]
      }

      const result = manager.extractToolCallsFromChunk(chunk)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'call_invalid',
        name: '$web_search',
        arguments: '{"search_result":',
        rawArguments: '{"search_result":'
      })
    })

    it('should return empty array when no tool calls', () => {
      const manager = new BuiltinToolStreamManager()
      const chunk = {}

      const result = manager.extractToolCallsFromChunk(chunk)

      expect(result).toEqual([])
    })

    it('should ignore malformed tool call entries safely', () => {
      const manager = new BuiltinToolStreamManager()
      const chunk = {
        toolCalls: [null, 'not-an-object', {}, { id: 'call_valid', function: { name: '$web_search', arguments: '{}' } }]
      }

      const result = manager.extractToolCallsFromChunk(chunk)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'call_valid',
        name: '$web_search',
        arguments: {}
      })
    })
  })

  describe('handleFinishStepWithBuiltinTools', () => {
    it('should return shouldContinue=false when no builtin tools', async () => {
      const manager = new BuiltinToolStreamManager()
      const context = toAiRequestContext({ builtinTools: {} })
      const chunk = { finishReason: 'tool_calls' }

      const result = await manager.handleFinishStepWithBuiltinTools(chunk, context)

      expect(result.shouldContinue).toBe(false)
    })

    it('should return shouldContinue=false when finishReason is not tool_calls', async () => {
      const manager = new BuiltinToolStreamManager()
      const context = toAiRequestContext({
        builtinTools: {
          $web_search: { isBuiltin: true }
        }
      })
      const chunk = { finishReason: 'stop' }

      const result = await manager.handleFinishStepWithBuiltinTools(chunk, context)

      expect(result.shouldContinue).toBe(false)
    })

    it('should return shouldContinue=true and updated messages for builtin tool calls', async () => {
      const manager = new BuiltinToolStreamManager()
      const context = toAiRequestContext({
        builtinTools: {
          $web_search: {
            type: 'provider',
            toolType: 'builtin_function',
            isBuiltin: true,
            definition: { type: 'builtin_function', function: { name: '$web_search' } }
          }
        }
      })
      const chunk = {
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call_789',
            type: 'builtin_function',
            function: { name: '$web_search', arguments: '{"search_result":{"search_id":"search_123"}}' }
          }
        ]
      }

      const result = await manager.handleFinishStepWithBuiltinTools(chunk, context)

      expect(result.shouldContinue).toBe(true)
      expect(result.updatedMessages).toBeDefined()
      expect(result.updatedMessages).toHaveLength(2) // assistant message + tool result

      // Verify assistant message with tool_calls
      expect(result.updatedMessages![0]).toMatchObject({
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_789',
            type: 'builtin_function',
            function: {
              name: '$web_search',
              arguments: '{"search_result":{"search_id":"search_123"}}'
            }
          }
        ]
      })

      // Verify tool result message
      expect(result.updatedMessages![1]).toMatchObject({
        role: 'tool',
        tool_call_id: 'call_789',
        name: '$web_search',
        content: '{"search_result":{"search_id":"search_123"}}'
      })
    })

    it('should handle mixed tool calls (builtin and non-builtin)', async () => {
      const manager = new BuiltinToolStreamManager()
      const context = toAiRequestContext({
        builtinTools: {
          $web_search: {
            isBuiltin: true,
            definition: { type: 'builtin_function', function: { name: '$web_search' } }
          }
        }
      })
      const chunk = {
        finishReason: 'tool_calls',
        toolCalls: [
          { id: 'call_1', function: { name: '$web_search', arguments: '{}' } },
          { id: 'call_2', function: { name: 'other_tool', arguments: '{}' } }
        ]
      }

      const result = await manager.handleFinishStepWithBuiltinTools(chunk, context)

      // Should continue because at least one builtin tool is present
      expect(result.shouldContinue).toBe(true)
      // Only builtin tool results should be in updatedMessages
      expect(result.updatedMessages![1]).toMatchObject({
        name: '$web_search'
      })
    })

    it('should return shouldContinue=false when builtinTools shape is invalid', async () => {
      const manager = new BuiltinToolStreamManager()
      const context = toAiRequestContext({
        builtinTools: 'invalid-registry'
      })
      const chunk = {
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_1', function: { name: '$web_search', arguments: '{}' } }]
      }

      const result = await manager.handleFinishStepWithBuiltinTools(chunk, context)

      expect(result.shouldContinue).toBe(false)
      expect(result.updatedMessages).toBeUndefined()
    })

    it('should ignore invalid builtin tool entries and continue with valid ones', async () => {
      const manager = new BuiltinToolStreamManager()
      const context = toAiRequestContext({
        builtinTools: {
          invalid_tool: 'invalid-entry',
          $web_search: {
            isBuiltin: true,
            toolType: 'builtin_function',
            definition: { type: 'builtin_function', function: { name: '$web_search' } }
          }
        }
      })
      const chunk = {
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_2', function: { name: '$web_search', arguments: '{}' } }]
      }

      const result = await manager.handleFinishStepWithBuiltinTools(chunk, context)

      expect(result.shouldContinue).toBe(true)
      expect(result.updatedMessages?.[1]).toMatchObject({
        role: 'tool',
        name: '$web_search'
      })
    })
  })

  describe('hasBuiltinToolCalls', () => {
    it('should return true when chunk has builtin tool calls', () => {
      const manager = new BuiltinToolStreamManager()
      const context = toAiRequestContext({
        builtinTools: {
          $web_search: { isBuiltin: true }
        }
      })
      const chunk = {
        toolCalls: [{ id: 'call_1', function: { name: '$web_search' } }]
      }

      expect(manager.hasBuiltinToolCalls(chunk, context)).toBe(true)
    })

    it('should return false when no builtin tool calls', () => {
      const manager = new BuiltinToolStreamManager()
      const context = toAiRequestContext({
        builtinTools: {}
      })
      const chunk = {
        toolCalls: [{ id: 'call_1', function: { name: 'other_tool' } }]
      }

      expect(manager.hasBuiltinToolCalls(chunk, context)).toBe(false)
    })

    it('should return false when builtinTools shape is invalid', () => {
      const manager = new BuiltinToolStreamManager()
      const context = toAiRequestContext({
        builtinTools: 12345
      })
      const chunk = {
        toolCalls: [{ id: 'call_1', function: { name: '$web_search', arguments: '{}' } }]
      }

      expect(manager.hasBuiltinToolCalls(chunk, context)).toBe(false)
    })
  })
})
