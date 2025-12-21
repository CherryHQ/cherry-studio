import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages'
import type { FinishReason, LanguageModelUsage, TextStreamPart, ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { AiSdkToAnthropicSSE, formatSSEDone, formatSSEEvent } from '../AiSdkToAnthropicSSE'

const createTextDelta = (text: string, id = 'text_0'): TextStreamPart<ToolSet> => ({
  type: 'text-delta',
  id,
  text
})

const createTextStart = (id = 'text_0'): TextStreamPart<ToolSet> => ({
  type: 'text-start',
  id
})

const createTextEnd = (id = 'text_0'): TextStreamPart<ToolSet> => ({
  type: 'text-end',
  id
})

const createFinish = (
  finishReason: FinishReason | undefined = 'stop',
  totalUsage?: Partial<LanguageModelUsage>
): TextStreamPart<ToolSet> => {
  const defaultUsage: LanguageModelUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  }
  const event: TextStreamPart<ToolSet> = {
    type: 'finish',
    finishReason: finishReason || 'stop',
    totalUsage: { ...defaultUsage, ...totalUsage }
  }
  return event
}

// Helper to create stream
function createMockStream(events: readonly TextStreamPart<ToolSet>[]) {
  return new ReadableStream<TextStreamPart<ToolSet>>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(event)
      }
      controller.close()
    }
  })
}

describe('AiSdkToAnthropicSSE', () => {
  describe('Text Processing', () => {
    it('should emit message_start and process text-delta events', async () => {
      const events: RawMessageStreamEvent[] = []
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        onEvent: (event) => events.push(event)
      })

      // Create a mock stream with text events
      const stream = createMockStream([createTextDelta('Hello'), createTextDelta(' world'), createFinish('stop')])

      await adapter.processStream(stream)

      // Verify message_start
      expect(events[0]).toMatchObject({
        type: 'message_start',
        message: {
          role: 'assistant',
          model: 'test:model'
        }
      })

      // Verify content_block_start for text
      expect(events[1]).toMatchObject({
        type: 'content_block_start',
        content_block: { type: 'text' }
      })

      // Verify text deltas
      expect(events[2]).toMatchObject({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello' }
      })
      expect(events[3]).toMatchObject({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: ' world' }
      })

      // Verify content_block_stop
      expect(events[4]).toMatchObject({
        type: 'content_block_stop'
      })

      // Verify message_delta with stop_reason
      expect(events[5]).toMatchObject({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' }
      })

      // Verify message_stop
      expect(events[6]).toMatchObject({
        type: 'message_stop'
      })
    })

    it('should handle text-start and text-end events', async () => {
      const events: RawMessageStreamEvent[] = []
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        onEvent: (event) => events.push(event)
      })

      const stream = createMockStream([
        createTextStart(),
        createTextDelta('Test'),
        createTextEnd(),
        createFinish('stop')
      ])

      await adapter.processStream(stream)

      // Should have content_block_start, delta, and content_block_stop
      const blockEvents = events.filter((e) => e.type.startsWith('content_block'))
      expect(blockEvents.length).toBeGreaterThanOrEqual(3)
    })

    it('should auto-start text block if not explicitly started', async () => {
      const events: RawMessageStreamEvent[] = []
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        onEvent: (event) => events.push(event)
      })

      const stream = createMockStream([createTextDelta('Auto-started'), createFinish('stop')])

      await adapter.processStream(stream)

      // Should automatically emit content_block_start
      expect(events.some((e) => e.type === 'content_block_start')).toBe(true)
    })
  })

  describe('Tool Call Processing', () => {
    it('should emit tool_use block for tool-call events', async () => {
      const events: RawMessageStreamEvent[] = []
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        onEvent: (event) => events.push(event)
      })

      const stream = createMockStream([
        {
          type: 'tool-call',
          toolCallId: 'call_123',
          toolName: 'get_weather',
          input: { location: 'SF' }
        },
        createFinish('tool-calls')
      ])

      await adapter.processStream(stream)

      // Find tool_use block events
      const blockStart = events.find((e) => {
        if (e.type === 'content_block_start') {
          return e.content_block.type === 'tool_use'
        }
        return false
      })
      expect(blockStart).toBeDefined()
      if (blockStart && blockStart.type === 'content_block_start') {
        expect(blockStart.content_block).toMatchObject({
          type: 'tool_use',
          id: 'call_123',
          name: 'get_weather'
        })
      }

      // Should emit input_json_delta
      const delta = events.find((e) => {
        if (e.type === 'content_block_delta') {
          return e.delta.type === 'input_json_delta'
        }
        return false
      })
      expect(delta).toBeDefined()

      // Should have stop_reason as tool_use
      const messageDelta = events.find((e) => e.type === 'message_delta')
      if (messageDelta && messageDelta.type === 'message_delta') {
        expect(messageDelta.delta.stop_reason).toBe('tool_use')
      }
    })

    it('should not create duplicate tool blocks', async () => {
      const events: RawMessageStreamEvent[] = []
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        onEvent: (event) => events.push(event)
      })

      const toolCallEvent: TextStreamPart<ToolSet> = {
        type: 'tool-call',
        toolCallId: 'call_123',
        toolName: 'test_tool',
        input: {}
      }
      const stream = createMockStream([toolCallEvent, toolCallEvent, createFinish()])

      await adapter.processStream(stream)

      // Should only have one tool_use block
      const toolBlocks = events.filter((e) => {
        if (e.type === 'content_block_start') {
          return e.content_block.type === 'tool_use'
        }
        return false
      })
      expect(toolBlocks.length).toBe(1)
    })
  })

  describe('Reasoning/Thinking Processing', () => {
    it('should emit thinking block for reasoning events', async () => {
      const events: RawMessageStreamEvent[] = []
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        onEvent: (event) => events.push(event)
      })

      const stream = createMockStream([
        { type: 'reasoning-start', id: 'reason_1' },
        { type: 'reasoning-delta', id: 'reason_1', text: 'Thinking...' },
        { type: 'reasoning-end', id: 'reason_1' },
        createFinish()
      ])

      await adapter.processStream(stream)

      // Find thinking block events
      const blockStart = events.find((e) => {
        if (e.type === 'content_block_start') {
          return e.content_block.type === 'thinking'
        }
        return false
      })
      expect(blockStart).toBeDefined()

      // Should emit thinking_delta
      const delta = events.find((e) => {
        if (e.type === 'content_block_delta') {
          return e.delta.type === 'thinking_delta'
        }
        return false
      })
      expect(delta).toBeDefined()
      if (delta && delta.type === 'content_block_delta' && delta.delta.type === 'thinking_delta') {
        expect(delta.delta.thinking).toBe('Thinking...')
      }
    })

    it('should handle multiple thinking blocks', async () => {
      const events: RawMessageStreamEvent[] = []
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        onEvent: (event) => events.push(event)
      })

      const stream = createMockStream([
        { type: 'reasoning-start', id: 'reason_1' },
        { type: 'reasoning-delta', id: 'reason_1', text: 'First thought' },
        { type: 'reasoning-start', id: 'reason_2' },
        { type: 'reasoning-delta', id: 'reason_2', text: 'Second thought' },
        { type: 'reasoning-end', id: 'reason_1' },
        { type: 'reasoning-end', id: 'reason_2' },
        createFinish()
      ])

      await adapter.processStream(stream)

      // Should have two thinking blocks
      const thinkingBlocks = events.filter((e) => {
        if (e.type === 'content_block_start') {
          return e.content_block.type === 'thinking'
        }
        return false
      })
      expect(thinkingBlocks.length).toBe(2)
    })
  })

  describe('Finish Reasons', () => {
    it('should map finish reasons correctly', async () => {
      const testCases: Array<{
        aiSdkReason: FinishReason
        expectedReason: string
      }> = [
        { aiSdkReason: 'stop', expectedReason: 'end_turn' },
        { aiSdkReason: 'length', expectedReason: 'max_tokens' },
        { aiSdkReason: 'tool-calls', expectedReason: 'tool_use' },
        { aiSdkReason: 'content-filter', expectedReason: 'refusal' }
      ]

      for (const { aiSdkReason, expectedReason } of testCases) {
        const events: RawMessageStreamEvent[] = []
        const adapter = new AiSdkToAnthropicSSE({
          model: 'test:model',
          onEvent: (event) => events.push(event)
        })

        const stream = createMockStream([createFinish(aiSdkReason)])

        await adapter.processStream(stream)

        const messageDelta = events.find((e) => e.type === 'message_delta')
        if (messageDelta && messageDelta.type === 'message_delta') {
          expect(messageDelta.delta.stop_reason).toBe(expectedReason)
        }
      }
    })
  })

  describe('Usage Tracking', () => {
    it('should track token usage', async () => {
      const events: RawMessageStreamEvent[] = []
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        inputTokens: 100,
        onEvent: (event) => events.push(event)
      })

      const stream = createMockStream([
        createTextDelta('Hello'),
        createFinish('stop', {
          inputTokens: 100,
          outputTokens: 50,
          cachedInputTokens: 20
        })
      ])

      await adapter.processStream(stream)

      const messageDelta = events.find((e) => e.type === 'message_delta')
      if (messageDelta && messageDelta.type === 'message_delta') {
        expect(messageDelta.usage).toMatchObject({
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20
        })
      }
    })
  })

  describe('Non-Streaming Response', () => {
    it('should build complete message for non-streaming', async () => {
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        onEvent: vi.fn()
      })

      const stream = createMockStream([
        createTextDelta('Hello world'),
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'test',
          input: { arg: 'value' }
        },
        createFinish('tool-calls', { inputTokens: 10, outputTokens: 20 })
      ])

      await adapter.processStream(stream)

      const response = adapter.buildNonStreamingResponse()

      expect(response).toMatchObject({
        type: 'message',
        role: 'assistant',
        model: 'test:model',
        stop_reason: 'tool_use'
      })

      expect(response.content).toHaveLength(2)
      expect(response.content[0]).toMatchObject({
        type: 'text',
        text: 'Hello world'
      })
      expect(response.content[1]).toMatchObject({
        type: 'tool_use',
        id: 'call_1',
        name: 'test',
        input: { arg: 'value' }
      })

      expect(response.usage).toMatchObject({
        input_tokens: 10,
        output_tokens: 20
      })
    })
  })

  describe('Error Handling', () => {
    it('should throw on error events', async () => {
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        onEvent: vi.fn()
      })

      const testError = new Error('Test error')
      const stream = createMockStream([{ type: 'error', error: testError }])

      await expect(adapter.processStream(stream)).rejects.toThrow('Test error')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty stream', async () => {
      const events: RawMessageStreamEvent[] = []
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        onEvent: (event) => events.push(event)
      })

      const stream = new ReadableStream<TextStreamPart<ToolSet>>({
        start(controller) {
          controller.close()
        }
      })

      await adapter.processStream(stream)

      // Should still emit message_start, message_delta, and message_stop
      expect(events.some((e) => e.type === 'message_start')).toBe(true)
      expect(events.some((e) => e.type === 'message_delta')).toBe(true)
      expect(events.some((e) => e.type === 'message_stop')).toBe(true)
    })

    it('should handle empty text deltas', async () => {
      const events: RawMessageStreamEvent[] = []
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        onEvent: (event) => events.push(event)
      })

      const stream = createMockStream([createTextDelta(''), createTextDelta(''), createFinish()])

      await adapter.processStream(stream)

      // Should not emit deltas for empty text
      const deltas = events.filter((e) => e.type === 'content_block_delta')
      expect(deltas.length).toBe(0)
    })
  })

  describe('Utility Functions', () => {
    it('should format SSE events correctly', () => {
      const event: RawMessageStreamEvent = {
        type: 'message_start',
        message: {
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'test',
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            server_tool_use: null
          }
        }
      }

      const formatted = formatSSEEvent(event)

      expect(formatted).toContain('event: message_start')
      expect(formatted).toContain('data: ')
      expect(formatted).toContain('"type":"message_start"')
      expect(formatted.endsWith('\n\n')).toBe(true)
    })

    it('should format SSE done marker correctly', () => {
      const done = formatSSEDone()

      expect(done).toBe('data: [DONE]\n\n')
    })
  })

  describe('Message ID', () => {
    it('should use provided message ID', () => {
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        messageId: 'custom_msg_123',
        onEvent: vi.fn()
      })

      expect(adapter.getMessageId()).toBe('custom_msg_123')
    })

    it('should generate message ID if not provided', () => {
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        onEvent: vi.fn()
      })

      const messageId = adapter.getMessageId()
      expect(messageId).toMatch(/^msg_/)
    })
  })

  describe('Input Tokens', () => {
    it('should allow setting input tokens', () => {
      const events: RawMessageStreamEvent[] = []
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        onEvent: (event) => events.push(event)
      })

      adapter.setInputTokens(500)

      const stream = createMockStream([createFinish()])

      return adapter.processStream(stream).then(() => {
        const messageStart = events.find((e) => e.type === 'message_start')
        if (messageStart && messageStart.type === 'message_start') {
          expect(messageStart.message.usage.input_tokens).toBe(500)
        }
      })
    })
  })
})
