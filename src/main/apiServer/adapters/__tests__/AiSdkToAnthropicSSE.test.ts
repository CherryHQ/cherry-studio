import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages'
import type { FinishReason, LanguageModelUsage, TextStreamPart, ToolSet } from 'ai'
import { describe, expect, it } from 'vitest'

import { AnthropicSSEFormatter } from '../formatters/AnthropicSSEFormatter'
import { AiSdkToAnthropicSSE } from '../stream/AiSdkToAnthropicSSE'

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
  const defaultUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  }
  // Cast to TextStreamPart to avoid strict type checking on optional fields
  return {
    type: 'finish',
    finishReason: finishReason || 'stop',
    totalUsage: { ...defaultUsage, ...totalUsage }
  } as TextStreamPart<ToolSet>
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

// Helper to collect all events from output stream
async function collectEvents(stream: ReadableStream<RawMessageStreamEvent>): Promise<RawMessageStreamEvent[]> {
  const events: RawMessageStreamEvent[] = []
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      events.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return events
}

describe('AiSdkToAnthropicSSE', () => {
  describe('Text Processing', () => {
    it('should emit message_start and process text-delta events', async () => {
      const adapter = new AiSdkToAnthropicSSE({ model: 'test:model' })

      // Create a mock stream with text events
      const stream = createMockStream([createTextDelta('Hello'), createTextDelta(' world'), createFinish('stop')])

      const outputStream = adapter.transform(stream)
      const events = await collectEvents(outputStream)

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
      const adapter = new AiSdkToAnthropicSSE({ model: 'test:model' })

      const stream = createMockStream([
        createTextStart(),
        createTextDelta('Test'),
        createTextEnd(),
        createFinish('stop')
      ])

      const outputStream = adapter.transform(stream)
      const events = await collectEvents(outputStream)

      // Should have content_block_start, delta, and content_block_stop
      const blockEvents = events.filter((e) => e.type.startsWith('content_block'))
      expect(blockEvents.length).toBeGreaterThanOrEqual(3)
    })

    it('should auto-start text block if not explicitly started', async () => {
      const adapter = new AiSdkToAnthropicSSE({ model: 'test:model' })

      const stream = createMockStream([createTextDelta('Auto-started'), createFinish('stop')])

      const outputStream = adapter.transform(stream)
      const events = await collectEvents(outputStream)

      // Should automatically emit content_block_start
      expect(events.some((e) => e.type === 'content_block_start')).toBe(true)
    })
  })

  describe('Tool Call Processing', () => {
    it('should emit tool_use block for tool-call events', async () => {
      const adapter = new AiSdkToAnthropicSSE({ model: 'test:model' })

      const stream = createMockStream([
        {
          type: 'tool-call',
          toolCallId: 'call_123',
          toolName: 'get_weather',
          input: { location: 'SF' }
        },
        createFinish('tool-calls')
      ])

      const outputStream = adapter.transform(stream)
      const events = await collectEvents(outputStream)

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
      const adapter = new AiSdkToAnthropicSSE({ model: 'test:model' })

      const toolCallEvent: TextStreamPart<ToolSet> = {
        type: 'tool-call',
        toolCallId: 'call_123',
        toolName: 'test_tool',
        input: {}
      }
      const stream = createMockStream([toolCallEvent, toolCallEvent, createFinish()])

      const outputStream = adapter.transform(stream)
      const events = await collectEvents(outputStream)

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
      const adapter = new AiSdkToAnthropicSSE({ model: 'test:model' })

      const stream = createMockStream([
        { type: 'reasoning-start', id: 'reason_1' },
        { type: 'reasoning-delta', id: 'reason_1', text: 'Thinking...' },
        { type: 'reasoning-end', id: 'reason_1' },
        createFinish()
      ])

      const outputStream = adapter.transform(stream)
      const events = await collectEvents(outputStream)

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
      const adapter = new AiSdkToAnthropicSSE({ model: 'test:model' })

      const stream = createMockStream([
        { type: 'reasoning-start', id: 'reason_1' },
        { type: 'reasoning-delta', id: 'reason_1', text: 'First thought' },
        { type: 'reasoning-start', id: 'reason_2' },
        { type: 'reasoning-delta', id: 'reason_2', text: 'Second thought' },
        { type: 'reasoning-end', id: 'reason_1' },
        { type: 'reasoning-end', id: 'reason_2' },
        createFinish()
      ])

      const outputStream = adapter.transform(stream)
      const events = await collectEvents(outputStream)

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
        const adapter = new AiSdkToAnthropicSSE({ model: 'test:model' })

        const stream = createMockStream([createFinish(aiSdkReason)])

        const outputStream = adapter.transform(stream)
        const events = await collectEvents(outputStream)

        const messageDelta = events.find((e) => e.type === 'message_delta')
        if (messageDelta && messageDelta.type === 'message_delta') {
          expect(messageDelta.delta.stop_reason).toBe(expectedReason)
        }
      }
    })
  })

  describe('Usage Tracking', () => {
    it('should track token usage', async () => {
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        inputTokens: 100
      })

      const stream = createMockStream([
        createTextDelta('Hello'),
        createFinish('stop', {
          inputTokens: 100,
          outputTokens: 50,
          cachedInputTokens: 20
        })
      ])

      const outputStream = adapter.transform(stream)
      const events = await collectEvents(outputStream)

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
      const adapter = new AiSdkToAnthropicSSE({ model: 'test:model' })

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

      // Consume the stream to populate adapter state
      const outputStream = adapter.transform(stream)
      const reader = outputStream.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
      reader.releaseLock()

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
      const adapter = new AiSdkToAnthropicSSE({ model: 'test:model' })

      const testError = new Error('Test error')
      const stream = createMockStream([{ type: 'error', error: testError }])

      const outputStream = adapter.transform(stream)

      await expect(collectEvents(outputStream)).rejects.toThrow('Test error')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty stream', async () => {
      const adapter = new AiSdkToAnthropicSSE({ model: 'test:model' })

      const stream = new ReadableStream<TextStreamPart<ToolSet>>({
        start(controller) {
          controller.close()
        }
      })

      const outputStream = adapter.transform(stream)
      const events = await collectEvents(outputStream)

      // Should still emit message_start, message_delta, and message_stop
      expect(events.some((e) => e.type === 'message_start')).toBe(true)
      expect(events.some((e) => e.type === 'message_delta')).toBe(true)
      expect(events.some((e) => e.type === 'message_stop')).toBe(true)
    })

    it('should handle empty text deltas', async () => {
      const adapter = new AiSdkToAnthropicSSE({ model: 'test:model' })

      const stream = createMockStream([createTextDelta(''), createTextDelta(''), createFinish()])

      const outputStream = adapter.transform(stream)
      const events = await collectEvents(outputStream)

      // Should not emit deltas for empty text
      const deltas = events.filter((e) => e.type === 'content_block_delta')
      expect(deltas.length).toBe(0)
    })
  })

  describe('AnthropicSSEFormatter', () => {
    it('should format SSE events correctly', () => {
      const formatter = new AnthropicSSEFormatter()
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

      const formatted = formatter.formatEvent(event)

      expect(formatted).toContain('event: message_start')
      expect(formatted).toContain('data: ')
      expect(formatted).toContain('"type":"message_start"')
      expect(formatted.endsWith('\n\n')).toBe(true)
    })

    it('should format SSE done marker correctly', () => {
      const formatter = new AnthropicSSEFormatter()
      const done = formatter.formatDone()

      expect(done).toBe('data: [DONE]\n\n')
    })
  })

  describe('Message ID', () => {
    it('should use provided message ID', () => {
      const adapter = new AiSdkToAnthropicSSE({
        model: 'test:model',
        messageId: 'custom_msg_123'
      })

      expect(adapter.getMessageId()).toBe('custom_msg_123')
    })

    it('should generate message ID if not provided', () => {
      const adapter = new AiSdkToAnthropicSSE({ model: 'test:model' })

      const messageId = adapter.getMessageId()
      expect(messageId).toMatch(/^msg_/)
    })
  })

  describe('Input Tokens', () => {
    it('should allow setting input tokens', async () => {
      const adapter = new AiSdkToAnthropicSSE({ model: 'test:model' })

      adapter.setInputTokens(500)

      const stream = createMockStream([createFinish()])

      const outputStream = adapter.transform(stream)
      const events = await collectEvents(outputStream)

      const messageStart = events.find((e) => e.type === 'message_start')
      if (messageStart && messageStart.type === 'message_start') {
        expect(messageStart.message.usage.input_tokens).toBe(500)
      }
    })
  })
})
