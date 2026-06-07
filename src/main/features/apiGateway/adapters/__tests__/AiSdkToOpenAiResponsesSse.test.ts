import type OpenAI from '@cherrystudio/openai'
import type { FinishReason, UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { OpenAiResponsesSseFormatter } from '../formatters/OpenAiResponsesSseFormatter'
import { AiSdkToOpenAiResponsesSse } from '../stream/AiSdkToOpenAiResponsesSse'

type ResponseStreamEvent = OpenAI.Responses.ResponseStreamEvent

const createTextDelta = (text: string, id = 'text_0'): UIMessageChunk => ({ type: 'text-delta', id, delta: text })

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

async function collectEvents(stream: ReadableStream<ResponseStreamEvent>): Promise<ResponseStreamEvent[]> {
  const events: ResponseStreamEvent[] = []
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

const typesOf = (events: ResponseStreamEvent[]) => events.map((e) => e.type)

describe('AiSdkToOpenAiResponsesSse', () => {
  describe('Text Processing', () => {
    it('emits the full lifecycle for a text-only response', async () => {
      const adapter = new AiSdkToOpenAiResponsesSse({ model: 'openai:gpt-4' })
      const stream = createMockStream([createTextDelta('Hello'), createTextDelta(' world'), createFinish('stop')])
      const events = await collectEvents(adapter.transform(stream))
      const types = typesOf(events)

      expect(types).toEqual(
        expect.arrayContaining([
          'response.created',
          'response.in_progress',
          'response.output_item.added',
          'response.content_part.added',
          'response.output_text.delta',
          'response.output_text.done',
          'response.content_part.done',
          'response.output_item.done',
          'response.completed'
        ])
      )

      const deltas = events.filter((e) => e.type === 'response.output_text.delta')
      expect(deltas.map((e) => (e as { delta: string }).delta)).toEqual(['Hello', ' world'])

      // sequence_number is monotonically increasing across all events.
      const seqs = events.map((e) => (e as { sequence_number: number }).sequence_number)
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    })
  })

  describe('Tool Call Processing (regression: function_call must not be dropped)', () => {
    it('emits a function_call output item lifecycle and includes it in response.completed', async () => {
      const adapter = new AiSdkToOpenAiResponsesSse({ model: 'openai:gpt-4' })
      const stream = createMockStream([
        { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'get_weather', input: { city: 'SF' } },
        createFinish('tool-calls')
      ])
      const events = await collectEvents(adapter.transform(stream))

      // The function_call item's streaming lifecycle is present.
      expect(typesOf(events)).toEqual(
        expect.arrayContaining([
          'response.output_item.added',
          'response.function_call_arguments.delta',
          'response.function_call_arguments.done',
          'response.output_item.done'
        ])
      )

      const argsDelta = events.find((e) => e.type === 'response.function_call_arguments.delta') as
        | { delta: string; item_id: string; output_index: number }
        | undefined
      expect(argsDelta?.delta).toBe(JSON.stringify({ city: 'SF' }))
      expect(argsDelta?.output_index).toBe(1) // message item is output_index 0

      const argsDone = events.find((e) => e.type === 'response.function_call_arguments.done') as
        | { arguments: string; name: string }
        | undefined
      expect(argsDone?.arguments).toBe(JSON.stringify({ city: 'SF' }))
      expect(argsDone?.name).toBe('get_weather')

      // response.completed must carry the function_call item — the bug was it emitting
      // status:'completed' with finish_reason 'tool_calls' but zero function_call items.
      const completed = events.find((e) => e.type === 'response.completed') as
        | { response: { output: Array<{ type: string; call_id?: string; name?: string; arguments?: string }> } }
        | undefined
      const functionCall = completed?.response.output.find((o) => o.type === 'function_call')
      expect(functionCall).toMatchObject({
        type: 'function_call',
        call_id: 'call_1',
        name: 'get_weather',
        arguments: JSON.stringify({ city: 'SF' })
      })
    })

    it('does not emit duplicate function_call items for the same toolCallId', async () => {
      const adapter = new AiSdkToOpenAiResponsesSse({ model: 'openai:gpt-4' })
      const toolCall: UIMessageChunk = {
        type: 'tool-input-available',
        toolCallId: 'call_1',
        toolName: 'f',
        input: {}
      }
      const events = await collectEvents(
        adapter.transform(createMockStream([toolCall, toolCall, createFinish('tool-calls')]))
      )
      expect(events.filter((e) => e.type === 'response.function_call_arguments.done').length).toBe(1)
    })
  })

  describe('Non-Streaming Response', () => {
    it('assembles text plus function_call items into output[]', async () => {
      const adapter = new AiSdkToOpenAiResponsesSse({ model: 'openai:gpt-4' })
      const stream = createMockStream([
        createTextDelta('Hello'),
        { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'test', input: { a: 1 } },
        createFinish('tool-calls', { inputTokens: 5, outputTokens: 9 })
      ])
      const reader = adapter.transform(stream).getReader()
      while (!(await reader.read()).done) {
        /* drain */
      }
      reader.releaseLock()

      const response = adapter.buildNonStreamingResponse() as unknown as {
        status: string
        output: Array<{ type: string; content?: unknown; call_id?: string; arguments?: string }>
        usage: { input_tokens: number; output_tokens: number; total_tokens: number }
      }

      expect(response.status).toBe('completed')
      const message = response.output.find((o) => o.type === 'message')
      const functionCall = response.output.find((o) => o.type === 'function_call')
      expect(message).toBeDefined()
      expect(functionCall).toMatchObject({ call_id: 'call_1', arguments: JSON.stringify({ a: 1 }) })
      expect(response.usage).toMatchObject({ input_tokens: 5, output_tokens: 9, total_tokens: 14 })
    })
  })

  describe('Error Handling', () => {
    it('throws on error chunks (pull path)', async () => {
      const adapter = new AiSdkToOpenAiResponsesSse({ model: 'openai:gpt-4' })
      const stream = createMockStream([{ type: 'error', errorText: 'boom' }])
      await expect(collectEvents(adapter.transform(stream))).rejects.toThrow('boom')
    })
  })

  describe('OpenAiResponsesSseFormatter', () => {
    it('formats events as named `event:`/`data:` frames', () => {
      const formatter = new OpenAiResponsesSseFormatter()
      const frame = formatter.formatEvent({
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        content_index: 0,
        delta: 'x',
        logprobs: [],
        sequence_number: 0
      } as ResponseStreamEvent)
      expect(frame).toContain('event: response.output_text.delta')
      expect(frame).toContain('data: ')
      expect(frame.endsWith('\n\n')).toBe(true)
    })
  })
})
