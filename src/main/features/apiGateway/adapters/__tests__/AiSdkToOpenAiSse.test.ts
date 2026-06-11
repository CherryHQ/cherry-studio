import type { FinishReason, UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { OpenAiSseFormatter } from '../formatters/OpenAiSseFormatter'
import { AiSdkToOpenAiSse, type OpenAiCompatibleChunk } from '../stream/AiSdkToOpenAiSse'

const createTextDelta = (text: string, id = 'text_0'): UIMessageChunk => ({ type: 'text-delta', id, delta: text })
const createReasoningDelta = (text: string, id = 'reason_0'): UIMessageChunk => ({
  type: 'reasoning-delta',
  id,
  delta: text
})

interface GatewayUsage {
  inputTokens?: number
  outputTokens?: number
}

const createFinish = (finishReason: FinishReason | undefined = 'stop', usage?: GatewayUsage): UIMessageChunk => {
  const messageMetadata =
    usage !== undefined
      ? {
          totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          promptTokens: usage.inputTokens ?? 0,
          completionTokens: usage.outputTokens ?? 0,
          thoughtsTokens: undefined
        }
      : undefined
  return { type: 'finish', finishReason: finishReason || 'stop', ...(messageMetadata ? { messageMetadata } : {}) }
}

function createMockStream(events: readonly UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const event of events) controller.enqueue(event)
      controller.close()
    }
  })
}

async function collectEvents(stream: ReadableStream<OpenAiCompatibleChunk>): Promise<OpenAiCompatibleChunk[]> {
  const events: OpenAiCompatibleChunk[] = []
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      events.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return events
}

describe('AiSdkToOpenAiSse', () => {
  describe('Text Processing', () => {
    it('emits an initial role chunk, content deltas, and a terminal finish chunk', async () => {
      const adapter = new AiSdkToOpenAiSse({ model: 'openai:gpt-4' })
      const stream = createMockStream([createTextDelta('Hello'), createTextDelta(' world'), createFinish('stop')])
      const events = await collectEvents(adapter.transform(stream))

      // First chunk carries the assistant role.
      expect(events[0].choices[0].delta).toMatchObject({ role: 'assistant' })
      expect(events[0]).toMatchObject({ object: 'chat.completion.chunk', model: 'openai:gpt-4' })

      // Content deltas.
      const contentDeltas = events.filter((e) => typeof e.choices[0].delta.content === 'string')
      expect(contentDeltas.map((e) => e.choices[0].delta.content)).toEqual(['Hello', ' world'])

      // Terminal chunk: finish_reason + usage.
      const final = events.at(-1)!
      expect(final.choices[0].finish_reason).toBe('stop')
      expect(final.usage).toBeDefined()
    })

    it('does not emit a chunk for empty text deltas', async () => {
      const adapter = new AiSdkToOpenAiSse({ model: 'openai:gpt-4' })
      const stream = createMockStream([createTextDelta(''), createFinish('stop')])
      const events = await collectEvents(adapter.transform(stream))

      expect(events.some((e) => e.choices[0].delta.content !== undefined)).toBe(false)
    })
  })

  describe('Reasoning Processing', () => {
    it('emits reasoning_content deltas (DeepSeek-style)', async () => {
      const adapter = new AiSdkToOpenAiSse({ model: 'openai:deepseek' })
      const stream = createMockStream([createReasoningDelta('thinking...'), createTextDelta('answer'), createFinish()])
      const events = await collectEvents(adapter.transform(stream))

      const reasoning = events.find((e) => typeof e.choices[0].delta.reasoning_content === 'string')
      expect(reasoning?.choices[0].delta.reasoning_content).toBe('thinking...')
    })
  })

  describe('Tool Call Processing', () => {
    it('emits a tool_calls delta and sets finish_reason to tool_calls', async () => {
      const adapter = new AiSdkToOpenAiSse({ model: 'openai:gpt-4' })
      const stream = createMockStream([
        { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'get_weather', input: { city: 'SF' } },
        createFinish('tool-calls')
      ])
      const events = await collectEvents(adapter.transform(stream))

      const toolChunk = events.find((e) => e.choices[0].delta.tool_calls)
      expect(toolChunk?.choices[0].delta.tool_calls?.[0]).toMatchObject({
        index: 0,
        id: 'call_1',
        type: 'function',
        function: { name: 'get_weather', arguments: JSON.stringify({ city: 'SF' }) }
      })
      expect(events.at(-1)!.choices[0].finish_reason).toBe('tool_calls')
    })

    it('does not emit duplicate tool_calls for the same toolCallId', async () => {
      const adapter = new AiSdkToOpenAiSse({ model: 'openai:gpt-4' })
      const toolCall: UIMessageChunk = {
        type: 'tool-input-available',
        toolCallId: 'call_1',
        toolName: 'f',
        input: {}
      }
      const stream = createMockStream([toolCall, toolCall, createFinish('tool-calls')])
      const events = await collectEvents(adapter.transform(stream))

      expect(events.filter((e) => e.choices[0].delta.tool_calls).length).toBe(1)
    })
  })

  describe('Finish Reasons', () => {
    it('maps AI SDK finish reasons to OpenAI finish_reason', async () => {
      const cases: Array<{ aiSdkReason: FinishReason; expected: string }> = [
        { aiSdkReason: 'stop', expected: 'stop' },
        { aiSdkReason: 'length', expected: 'length' },
        { aiSdkReason: 'tool-calls', expected: 'tool_calls' },
        { aiSdkReason: 'content-filter', expected: 'content_filter' }
      ]
      for (const { aiSdkReason, expected } of cases) {
        const adapter = new AiSdkToOpenAiSse({ model: 'openai:gpt-4' })
        const events = await collectEvents(adapter.transform(createMockStream([createFinish(aiSdkReason)])))
        expect(events.at(-1)!.choices[0].finish_reason).toBe(expected)
      }
    })
  })

  describe('Usage Tracking', () => {
    it('projects prompt/completion tokens onto the terminal usage', async () => {
      const adapter = new AiSdkToOpenAiSse({ model: 'openai:gpt-4' })
      const stream = createMockStream([
        createTextDelta('hi'),
        createFinish('stop', { inputTokens: 12, outputTokens: 7 })
      ])
      const events = await collectEvents(adapter.transform(stream))
      expect(events.at(-1)!.usage).toMatchObject({ prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 })
    })
  })

  describe('Non-Streaming Response', () => {
    it('assembles content, reasoning_content, and tool_calls into a single completion', async () => {
      const adapter = new AiSdkToOpenAiSse({ model: 'openai:gpt-4' })
      const stream = createMockStream([
        createReasoningDelta('because'),
        createTextDelta('Hello world'),
        { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'test', input: { arg: 'value' } },
        createFinish('tool-calls', { inputTokens: 10, outputTokens: 20 })
      ])
      const reader = adapter.transform(stream).getReader()
      while (!(await reader.read()).done) {
        /* drain to populate state */
      }
      reader.releaseLock()

      const response = adapter.buildNonStreamingResponse()
      expect(response).toMatchObject({
        object: 'chat.completion',
        model: 'openai:gpt-4',
        choices: [{ index: 0, finish_reason: 'tool_calls' }]
      })
      expect(response.choices[0].message.content).toBe('Hello world')
      expect(response.choices[0].message.reasoning_content).toBe('because')
      expect(response.choices[0].message.tool_calls?.[0]).toMatchObject({
        id: 'call_1',
        type: 'function',
        function: { name: 'test', arguments: JSON.stringify({ arg: 'value' }) }
      })
      expect(response.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 })
    })
  })

  describe('Error Handling', () => {
    it('throws on error chunks (pull path)', async () => {
      const adapter = new AiSdkToOpenAiSse({ model: 'openai:gpt-4' })
      const stream = createMockStream([{ type: 'error', errorText: 'boom' }])
      await expect(collectEvents(adapter.transform(stream))).rejects.toThrow('boom')
    })
  })

  describe('Edge Cases', () => {
    it('handles an empty stream (still emits role + finish)', async () => {
      const adapter = new AiSdkToOpenAiSse({ model: 'openai:gpt-4' })
      const empty = new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.close()
        }
      })
      const events = await collectEvents(adapter.transform(empty))
      expect(events[0].choices[0].delta).toMatchObject({ role: 'assistant' })
      expect(events.at(-1)!.choices[0].finish_reason).toBe('stop')
    })
  })

  describe('OpenAiSseFormatter', () => {
    it('formats events as `data: <json>` frames', () => {
      const formatter = new OpenAiSseFormatter()
      const frame = formatter.formatEvent({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'm',
        choices: [{ index: 0, delta: { content: 'x' }, finish_reason: null }]
      })
      expect(frame.startsWith('data: ')).toBe(true)
      expect(frame.endsWith('\n\n')).toBe(true)
      expect(frame).toContain('"content":"x"')
    })

    it('emits `data: [DONE]` as the done marker', () => {
      expect(new OpenAiSseFormatter().formatDone()).toBe('data: [DONE]\n\n')
    })
  })
})
