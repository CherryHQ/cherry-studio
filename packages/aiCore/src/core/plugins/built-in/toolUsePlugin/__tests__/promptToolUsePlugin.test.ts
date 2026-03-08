import type { TextStreamPart, ToolSet } from 'ai'
import { simulateReadableStream } from 'ai'
import { convertReadableStreamToArray } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'

import { createMockContext, createMockStreamParams, createMockTool, createMockToolSet } from '../../../../../__tests__'
import { createPromptToolUsePlugin, DEFAULT_SYSTEM_PROMPT } from '../promptToolUsePlugin'

describe('promptToolUsePlugin', () => {
  describe('Factory Function', () => {
    it('should return AiPlugin with correct name', () => {
      const plugin = createPromptToolUsePlugin()

      expect(plugin.name).toBe('built-in:prompt-tool-use')
      expect(plugin.transformParams).toBeDefined()
      expect(plugin.transformStream).toBeDefined()
    })

    it('should accept empty configuration', () => {
      const plugin = createPromptToolUsePlugin({})

      expect(plugin).toBeDefined()
      expect(plugin.name).toBe('built-in:prompt-tool-use')
    })

    it('should accept custom buildSystemPrompt', () => {
      const customBuildSystemPrompt = vi.fn((userSystemPrompt: string) => userSystemPrompt)

      const plugin = createPromptToolUsePlugin({
        buildSystemPrompt: customBuildSystemPrompt
      })

      expect(plugin).toBeDefined()
    })

    it('should accept custom parseToolUse', () => {
      const customParseToolUse = vi.fn(() => ({ results: [], content: '' }))

      const plugin = createPromptToolUsePlugin({
        parseToolUse: customParseToolUse
      })

      expect(plugin).toBeDefined()
    })

    it('should accept enabled flag', () => {
      const pluginDisabled = createPromptToolUsePlugin({ enabled: false })
      const pluginEnabled = createPromptToolUsePlugin({ enabled: true })

      expect(pluginDisabled).toBeDefined()
      expect(pluginEnabled).toBeDefined()
    })
  })

  describe('transformParams', () => {
    it('should separate provider and prompt tools', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      const params = createMockStreamParams({
        tools: createMockToolSet({
          provider_tool: 'provider',
          prompt_tool: 'function'
        })
      })

      const result = await Promise.resolve(plugin.transformParams!(params, context))

      // Provider tools should remain in tools
      expect(result.tools).toBeDefined()
      expect(result.tools).toHaveProperty('provider_tool')
      expect(result.tools).not.toHaveProperty('prompt_tool')

      // Prompt tools should be moved to context.mcpTools
      expect(context.mcpTools).toBeDefined()
      expect(context.mcpTools).toHaveProperty('prompt_tool')
      expect(context.mcpTools).not.toHaveProperty('provider_tool')
    })

    it('should handle only provider tools', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      const params = createMockStreamParams({
        tools: createMockToolSet({
          provider_tool1: 'provider',
          provider_tool2: 'provider'
        })
      })

      const result = await Promise.resolve(plugin.transformParams!(params, context))

      expect(result.tools).toEqual(params.tools)
      expect(context.mcpTools).toBeUndefined()
    })

    it('should handle only prompt tools', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      const params = createMockStreamParams({
        tools: createMockToolSet({
          prompt_tool1: 'function',
          prompt_tool2: 'function'
        })
      })

      const result = await Promise.resolve(plugin.transformParams!(params, context))

      expect(result.tools).toBeUndefined()
      expect(context.mcpTools).toEqual(params.tools)
    })

    it('should build system prompt for prompt tools', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      const params = createMockStreamParams({
        system: 'Original system prompt',
        tools: {
          test_tool: createMockTool('test_tool', 'Test tool description')
        }
      })

      const result = await Promise.resolve(plugin.transformParams!(params, context))

      expect(result.system).toBeDefined()
      expect(typeof result.system).toBe('string')
      expect(result.system).toContain('In this environment you have access to a set of tools')
      expect(result.system).toContain('test_tool')
      expect(result.system).toContain('Test tool description')
      expect(result.system).toContain('Original system prompt')
    })

    it('should handle empty user system prompt', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      const params = createMockStreamParams({
        tools: {
          test_tool: createMockTool('test_tool')
        }
      })

      const result = await Promise.resolve(plugin.transformParams!(params, context))

      expect(result.system).toBeDefined()
      expect(result.system).toContain('In this environment you have access to a set of tools')
    })

    it('should skip system prompt when disabled', async () => {
      const plugin = createPromptToolUsePlugin({ enabled: false })
      const context = createMockContext()
      const params = createMockStreamParams({
        system: 'Original',
        tools: {
          test_tool: createMockTool('test_tool')
        }
      })

      const result = await Promise.resolve(plugin.transformParams!(params, context))

      expect(result).toEqual(params)
      expect(context.mcpTools).toBeUndefined()
    })

    it('should skip when no tools provided', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      const params = createMockStreamParams({
        system: 'Original'
      })

      const result = await Promise.resolve(plugin.transformParams!(params, context))

      expect(result).toEqual(params)
    })

    it('should skip when tools is not an object', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      const params = createMockStreamParams({
        system: 'Original',
        tools: 'invalid' as any
      })

      const result = await Promise.resolve(plugin.transformParams!(params, context))

      expect(result).toEqual(params)
    })

    it('should use custom buildSystemPrompt when provided', async () => {
      const customBuildSystemPrompt = vi.fn((userSystemPrompt: string, tools: ToolSet) => {
        return `Custom prompt with ${Object.keys(tools).length} tools and user prompt: ${userSystemPrompt}`
      })

      const plugin = createPromptToolUsePlugin({
        buildSystemPrompt: customBuildSystemPrompt
      })

      const context = createMockContext()
      const params = createMockStreamParams({
        system: 'User prompt',
        tools: {
          tool1: createMockTool('tool1')
        }
      })

      const result = await Promise.resolve(plugin.transformParams!(params, context))

      expect(customBuildSystemPrompt).toHaveBeenCalled()
      expect(result.system).toBe('Custom prompt with 1 tools and user prompt: User prompt')
    })

    it('should save originalParams to context', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      const params = createMockStreamParams({
        system: 'Original',
        tools: {
          test: createMockTool('test')
        }
      })

      await Promise.resolve(plugin.transformParams!(params, context))

      expect(context.originalParams).toBeDefined()
      expect(context.originalParams.system).toBeDefined()
    })

    it('should NOT rebuild system prompt on recursive call', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      const params = createMockStreamParams({
        system: 'User system prompt',
        tools: {
          test_tool: createMockTool('test_tool', 'A test tool')
        }
      })

      // First call: build the system prompt with tools
      const firstResult = await Promise.resolve(plugin.transformParams!(params, context))
      const firstSystemPrompt = firstResult.system as string

      // Verify first call includes tool definitions
      expect(firstSystemPrompt).toContain('test_tool')

      // Simulate recursive call: isRecursiveCall is true
      context.isRecursiveCall = true

      const recursiveParams = createMockStreamParams({
        system: firstSystemPrompt,
        tools: {
          test_tool: createMockTool('test_tool', 'A test tool')
        }
      })

      const recursiveResult = await Promise.resolve(plugin.transformParams!(recursiveParams, context))

      // System prompt should NOT be rebuilt - it should remain the same
      expect(recursiveResult.system).toBe(firstSystemPrompt)

      // Count occurrences of tool definition to ensure no duplication
      const toolOccurrences = (recursiveResult.system as string).split('test_tool').length - 1
      const firstToolOccurrences = firstSystemPrompt.split('test_tool').length - 1
      expect(toolOccurrences).toBe(firstToolOccurrences)
    })
  })

  describe('transformStream', () => {
    it('should return identity transform when disabled', async () => {
      const plugin = createPromptToolUsePlugin({ enabled: false })
      const context = createMockContext()

      const inputChunks: Array<{ type: 'text-delta'; text: string }> = [
        { type: 'text-delta', text: 'Hello' },
        { type: 'text-delta', text: ' World' }
      ]

      const inputStream = simulateReadableStream<TextStreamPart<ToolSet>>({
        chunks: inputChunks as TextStreamPart<ToolSet>[],
        initialDelayInMs: 0,
        chunkDelayInMs: 0
      })

      const transform = plugin.transformStream!(createMockStreamParams(), context)()
      const result = await convertReadableStreamToArray(inputStream.pipeThrough(transform))

      expect(result).toEqual(inputChunks)
    })

    it('should return identity transform when no mcpTools in context', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      // Don't set context.mcpTools

      const inputChunks: Array<{ type: 'text-delta'; text: string }> = [
        { type: 'text-delta', text: 'Hello' },
        { type: 'text-delta', text: ' World' }
      ]

      const inputStream = simulateReadableStream<TextStreamPart<ToolSet>>({
        chunks: inputChunks as TextStreamPart<ToolSet>[],
        initialDelayInMs: 0,
        chunkDelayInMs: 0
      })

      const transform = plugin.transformStream!(createMockStreamParams(), context)()
      const result = await convertReadableStreamToArray(inputStream.pipeThrough(transform))

      expect(result).toEqual(inputChunks)
    })

    it('should initialize accumulatedUsage in context', () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      context.mcpTools = {
        test: createMockTool('test')
      }

      plugin.transformStream!(createMockStreamParams(), context)()

      expect(context.accumulatedUsage).toBeDefined()
      expect(context.accumulatedUsage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0
      })
    })

    it('should filter tool tags from text-delta chunks', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      context.mcpTools = {
        test: createMockTool('test')
      }

      const inputChunks = [
        { type: 'text-start' as const },
        { type: 'text-delta' as const, text: 'Before ' },
        { type: 'text-delta' as const, text: '<tool_use>' },
        { type: 'text-delta' as const, text: '<name>test</name>' },
        { type: 'text-delta' as const, text: '<arguments>{}</arguments>' },
        { type: 'text-delta' as const, text: '</tool_use>' },
        { type: 'text-delta' as const, text: ' After' },
        { type: 'text-end' as const }
      ]

      const inputStream = simulateReadableStream<TextStreamPart<ToolSet>>({
        chunks: inputChunks as TextStreamPart<ToolSet>[],
        initialDelayInMs: 0,
        chunkDelayInMs: 0
      })

      const transform = plugin.transformStream!(createMockStreamParams(), context)()
      const result = await convertReadableStreamToArray(inputStream.pipeThrough(transform))

      // Extract text from text-delta chunks
      const textChunks = result.filter((chunk) => chunk.type === 'text-delta')
      const fullText = textChunks.map((chunk) => 'text' in chunk && chunk.text).join('')

      // Tool tags should be filtered out
      expect(fullText).not.toContain('<tool_use>')
      expect(fullText).not.toContain('</tool_use>')
      expect(fullText).toContain('Before')
      expect(fullText).toContain('After')
    })

    it('should hold text-start until non-tag content appears', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      context.mcpTools = {
        test: createMockTool('test')
      }

      // Only tool tags, no actual content
      const inputChunks = [
        { type: 'text-start' as const },
        { type: 'text-delta' as const, text: '<tool_use>' },
        { type: 'text-delta' as const, text: '<name>test</name>' },
        { type: 'text-delta' as const, text: '<arguments>{}</arguments>' },
        { type: 'text-delta' as const, text: '</tool_use>' },
        { type: 'text-end' as const }
      ]

      const inputStream = simulateReadableStream<TextStreamPart<ToolSet>>({
        chunks: inputChunks as TextStreamPart<ToolSet>[],
        initialDelayInMs: 0,
        chunkDelayInMs: 0
      })

      const transform = plugin.transformStream!(createMockStreamParams(), context)()
      const result = await convertReadableStreamToArray(inputStream.pipeThrough(transform))

      // Should not have text-start or text-end since all content was tool tags
      expect(result.some((chunk) => chunk.type === 'text-start')).toBe(false)
      expect(result.some((chunk) => chunk.type === 'text-end')).toBe(false)
    })

    it('should send text-start when non-tag content appears', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      context.mcpTools = {
        test: createMockTool('test')
      }

      const inputChunks = [
        { type: 'text-start' as const },
        { type: 'text-delta' as const, text: 'Actual content' },
        { type: 'text-end' as const }
      ]

      const inputStream = simulateReadableStream<TextStreamPart<ToolSet>>({
        chunks: inputChunks as TextStreamPart<ToolSet>[],
        initialDelayInMs: 0,
        chunkDelayInMs: 0
      })

      const transform = plugin.transformStream!(createMockStreamParams(), context)()
      const result = await convertReadableStreamToArray(inputStream.pipeThrough(transform))

      // Should have text-start, text-delta, and text-end
      expect(result.some((chunk) => chunk.type === 'text-start')).toBe(true)
      expect(result.some((chunk) => chunk.type === 'text-delta')).toBe(true)
      expect(result.some((chunk) => chunk.type === 'text-end')).toBe(true)
    })

    it('should pass through non-text events', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      context.mcpTools = {
        test: createMockTool('test')
      }

      const stepStartEvent = { type: 'start-step' as const, request: {}, warnings: [] }

      const inputChunks = [stepStartEvent]

      const inputStream = simulateReadableStream<TextStreamPart<ToolSet>>({
        chunks: inputChunks as TextStreamPart<ToolSet>[],
        initialDelayInMs: 0,
        chunkDelayInMs: 0
      })

      const transform = plugin.transformStream!(createMockStreamParams(), context)()
      const result = await convertReadableStreamToArray(inputStream.pipeThrough(transform))

      expect(result[0]).toEqual(stepStartEvent)
    })

    it('should accumulate usage from finish-step events', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      context.mcpTools = {
        test: createMockTool('test')
      }

      const inputChunks = [
        {
          type: 'finish-step' as const,
          finishReason: 'stop' as const,
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30
          }
        }
      ]

      const inputStream = simulateReadableStream<TextStreamPart<ToolSet>>({
        chunks: inputChunks as TextStreamPart<ToolSet>[],
        initialDelayInMs: 0,
        chunkDelayInMs: 0
      })

      const transform = plugin.transformStream!(createMockStreamParams(), context)()
      await convertReadableStreamToArray(inputStream.pipeThrough(transform))

      // Verify usage was accumulated
      expect(context.accumulatedUsage).toBeDefined()
      expect(context.accumulatedUsage!.inputTokens).toBe(10)
      expect(context.accumulatedUsage!.outputTokens).toBe(20)
      expect(context.accumulatedUsage!.totalTokens).toBe(30)
    })

    it('should include accumulated usage in finish event', async () => {
      const plugin = createPromptToolUsePlugin()
      const context = createMockContext()
      context.mcpTools = {
        test: createMockTool('test')
      }

      // Pre-populate accumulated usage
      context.accumulatedUsage = {
        inputTokens: 5,
        outputTokens: 10,
        totalTokens: 15,
        reasoningTokens: 0,
        cachedInputTokens: 0
      }

      const inputChunks = [
        {
          type: 'finish' as const,
          finishReason: 'stop' as const,
          usage: {
            inputTokens: 100,
            outputTokens: 200,
            totalTokens: 300
          }
        }
      ]

      const inputStream = simulateReadableStream<TextStreamPart<ToolSet>>({
        chunks: inputChunks as unknown as TextStreamPart<ToolSet>[],
        initialDelayInMs: 0,
        chunkDelayInMs: 0
      })

      const transform = plugin.transformStream!(createMockStreamParams(), context)()
      const result = await convertReadableStreamToArray(inputStream.pipeThrough(transform))

      const finishEvent = result.find((chunk) => chunk.type === 'finish')
      expect(finishEvent).toBeDefined()
      if (finishEvent && 'totalUsage' in finishEvent) {
        expect(finishEvent.totalUsage).toEqual(context.accumulatedUsage)
      }
    })
  })

  describe('Type Safety', () => {
    it('should have correct generic parameters for StreamTextParams and StreamTextResult', () => {
      const plugin = createPromptToolUsePlugin()

      // Type assertion to verify the plugin has the correct type
      type PluginType = typeof plugin
      const typeTest: PluginType = plugin

      expect(typeTest.name).toBe('built-in:prompt-tool-use')
    })
  })

  describe('DEFAULT_SYSTEM_PROMPT', () => {
    it('should contain required sections', () => {
      expect(DEFAULT_SYSTEM_PROMPT).toContain('Tool Use Formatting')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('Tool Use Rules')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('Response rules')
    })

    it('should have placeholders for dynamic content', () => {
      expect(DEFAULT_SYSTEM_PROMPT).toContain('{{ TOOLS_INFO }}')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('{{ USER_SYSTEM_PROMPT }}')
    })

    it('should contain XML tag examples', () => {
      expect(DEFAULT_SYSTEM_PROMPT).toContain('<tool_use>')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('</tool_use>')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('<name>')
      expect(DEFAULT_SYSTEM_PROMPT).toContain('<arguments>')
    })
  })
})
