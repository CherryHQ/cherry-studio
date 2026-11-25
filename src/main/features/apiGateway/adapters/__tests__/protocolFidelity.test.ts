import { convertToModelMessages, type UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { OpenAiMessageConverter } from '../converters/OpenAiMessageConverter'
import type { IStreamAdapter } from '../interfaces'
import { AiSdkToAnthropicSse } from '../stream/AiSdkToAnthropicSse'
import { AiSdkToOpenAiResponsesSse } from '../stream/AiSdkToOpenAiResponsesSse'
import { AiSdkToOpenAiSse } from '../stream/AiSdkToOpenAiSse'

function events<T>(adapter: IStreamAdapter<T>, chunks: UIMessageChunk[]): T[] {
  return [...chunks.flatMap((chunk) => adapter.transformChunk(chunk)), ...adapter.finalizeEvents()]
}

const call: UIMessageChunk = {
  type: 'tool-input-available',
  toolCallId: 'lookup_1',
  toolName: 'lookup',
  input: { query: 'example' }
}

describe('gateway protocol fidelity', () => {
  it.each(['stop', 'tool-calls', 'other'] as const)('retains complete tools with a final %s', (reason) => {
    const chunks: UIMessageChunk[] = [call, { type: 'finish', finishReason: reason }]
    expect(events(new AiSdkToOpenAiSse({ model: 'test' }), chunks).at(-1)?.choices[0].finish_reason).toBe('tool_calls')
    expect(
      events(new AiSdkToAnthropicSse({ model: 'test' }), chunks).find((event) => event.type === 'message_delta')
    ).toMatchObject({ delta: { stop_reason: 'tool_use' } })
    const response = new AiSdkToOpenAiResponsesSse({ model: 'test' })
    expect(events(response, chunks).at(-1)).toMatchObject({ type: 'response.completed' })
    expect(response.buildNonStreamingResponse().output.some((part) => part.type === 'function_call')).toBe(true)
  })

  it.each(['stop', 'other'] as const)('keeps a tool-free final %s successful', (reason) => {
    const chunks: UIMessageChunk[] = [{ type: 'finish', finishReason: reason }]
    expect(events(new AiSdkToOpenAiSse({ model: 'test' }), chunks).at(-1)?.choices[0].finish_reason).toBe('stop')
    expect(
      events(new AiSdkToAnthropicSse({ model: 'test' }), chunks).find((event) => event.type === 'message_delta')
    ).toMatchObject({ delta: { stop_reason: 'end_turn' } })
    expect(events(new AiSdkToOpenAiResponsesSse({ model: 'test' }), chunks).at(-1)).toMatchObject({
      type: 'response.completed'
    })
  })

  it('rejects an explicit final error even when a tool call completed', () => {
    const chunks: UIMessageChunk[] = [call, { type: 'finish', finishReason: 'error' }]
    expect(() => events(new AiSdkToOpenAiSse({ model: 'test' }), chunks)).toThrow(/non-success/)
    expect(() => events(new AiSdkToAnthropicSse({ model: 'test' }), chunks)).toThrow(/non-success/)
    expect(() => events(new AiSdkToOpenAiResponsesSse({ model: 'test' }), chunks)).toThrow(/non-success/)
  })

  it('retains one authoritative encrypted reasoning snapshot through streaming and request replay', async () => {
    const details = [{ type: 'reasoning.encrypted', id: 'reasoning_1', format: 'anthropic-claude-v1', data: 'opaque' }]
    const metadata = { openrouter: { reasoning_details: details } }
    const adapter = new AiSdkToOpenAiSse({ model: 'openrouter:claude' })
    const output = events(adapter, [
      {
        type: 'reasoning-start',
        id: 'r1',
        providerMetadata: {
          openrouter: {
            reasoning_details: [
              { type: 'reasoning.encrypted', id: 'reasoning_1', format: 'anthropic-claude-v1', data: 'partial' }
            ]
          }
        }
      },
      { type: 'reasoning-end', id: 'r1', providerMetadata: metadata },
      { ...call, providerMetadata: metadata },
      { type: 'finish', finishReason: 'tool-calls' }
    ])
    expect(output.flatMap((event) => event.choices[0].delta.reasoning_details ?? [])).toEqual(details)
    expect(adapter.buildNonStreamingResponse().choices[0].message.reasoning_details).toEqual(details)
    const assistant = {
      role: 'assistant' as const,
      content: null,
      reasoning_details: details,
      tool_calls: [
        { id: 'lookup_1', type: 'function' as const, function: { name: 'lookup', arguments: '{"query":"example"}' } }
      ]
    }
    const messages = new OpenAiMessageConverter().toUIMessages({
      model: 'openrouter:claude',
      messages: [assistant, { role: 'tool', tool_call_id: 'lookup_1', content: 'found' }]
    })
    const modelMessages = await convertToModelMessages(messages)
    expect(modelMessages[0]).toMatchObject({
      role: 'assistant',
      content: expect.arrayContaining([{ type: 'reasoning', text: '', providerOptions: metadata }])
    })
  })

  it('keeps cache writes distinct from cache reads and cache-inclusive input totals', () => {
    const chunks: UIMessageChunk[] = [
      {
        type: 'message-metadata',
        messageMetadata: {
          stats: {
            inputTokens: 100,
            outputTokens: 10,
            inputTokenDetails: { cacheReadTokens: 20, cacheWriteTokens: 30 }
          }
        }
      },
      { type: 'finish', finishReason: 'stop' }
    ]
    const chat = events(new AiSdkToOpenAiSse({ model: 'openrouter:claude' }), chunks)
    expect(chat.at(-1)?.usage).toMatchObject({
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
      prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 30 }
    })
    const responses = events(new AiSdkToOpenAiResponsesSse({ model: 'test' }), chunks)
    expect(responses.at(-1)).toMatchObject({
      type: 'response.completed',
      response: {
        usage: {
          input_tokens: 100,
          output_tokens: 10,
          total_tokens: 110,
          input_tokens_details: { cached_tokens: 20, cache_write_tokens: 30 }
        }
      }
    })
  })

  it('retains reported Anthropic thinking usage without changing the output total', () => {
    const adapter = new AiSdkToAnthropicSse({ model: 'anthropic:claude' })
    const output = events(adapter, [
      {
        type: 'message-metadata',
        messageMetadata: {
          stats: {
            inputTokens: 100,
            outputTokens: 10,
            outputTokenDetails: { reasoningTokens: 7 }
          }
        }
      },
      { type: 'finish', finishReason: 'stop' }
    ])
    expect(output.find((event) => event.type === 'message_delta')).toMatchObject({
      usage: {
        output_tokens: 10,
        output_tokens_details: { thinking_tokens: 7 }
      }
    })
    expect(adapter.buildNonStreamingResponse()).toMatchObject({
      usage: {
        output_tokens: 10,
        output_tokens_details: { thinking_tokens: 7 }
      }
    })
  })

  it('preserves a reported zero cache write without inventing a cache-read breakdown', () => {
    const chunks: UIMessageChunk[] = [
      {
        type: 'message-metadata',
        messageMetadata: { stats: { inputTokens: 100, inputTokenDetails: { cacheWriteTokens: 0 } } }
      },
      { type: 'finish', finishReason: 'stop' }
    ]
    const chat = events(new AiSdkToOpenAiSse({ model: 'test' }), chunks).at(-1)
    expect(chat?.usage?.prompt_tokens_details).toEqual({ cache_write_tokens: 0 })
    const response = new AiSdkToOpenAiResponsesSse({ model: 'test' })
    events(response, chunks)
    expect(response.buildNonStreamingResponse().usage?.input_tokens_details).toEqual({ cache_write_tokens: 0 })
  })

  it.each([
    { reason: 'length', chat: 'length', anthropic: 'max_tokens', responses: 'max_output_tokens' },
    { reason: 'content-filter', chat: 'content_filter', anthropic: 'refusal', responses: 'content_filter' }
  ] as const)('preserves $reason after a complete tool call', ({ reason, chat, anthropic, responses }) => {
    const chunks: UIMessageChunk[] = [call, { type: 'finish', finishReason: reason }]
    expect(events(new AiSdkToOpenAiSse({ model: 'test' }), chunks).at(-1)?.choices[0].finish_reason).toBe(chat)
    expect(
      events(new AiSdkToAnthropicSse({ model: 'test' }), chunks).find((event) => event.type === 'message_delta')
    ).toMatchObject({ delta: { stop_reason: anthropic } })
    expect(events(new AiSdkToOpenAiResponsesSse({ model: 'test' }), chunks).at(-1)).toMatchObject({
      type: 'response.incomplete',
      response: { status: 'incomplete', incomplete_details: { reason: responses } }
    })
  })
})

describe('controlled native terminal metadata', () => {
  it.each(['length', 'content-filter'] as const)(
    'keeps %s ahead of a native stop string and completed tools',
    (reason) => {
      const adapter = new AiSdkToAnthropicSse({ model: 'test' })
      const output = events(adapter, [
        call,
        {
          type: 'message-metadata',
          messageMetadata: {
            rawFinishReason: 'stop_sequence',
            providerMetadata: { anthropic: { stopSequence: 'END' } }
          }
        },
        { type: 'finish', finishReason: reason }
      ])
      expect(output.find((event) => event.type === 'message_delta')).toMatchObject({
        delta: {
          stop_reason: reason === 'length' ? 'max_tokens' : 'refusal',
          stop_sequence: null
        }
      })
      expect(adapter.buildNonStreamingResponse()).toMatchObject({
        stop_reason: reason === 'length' ? 'max_tokens' : 'refusal',
        stop_sequence: null
      })
    }
  )

  it('ignores native stop names from a different provider namespace', () => {
    const adapter = new AiSdkToAnthropicSse({ model: 'test' })
    events(adapter, [
      {
        type: 'message-metadata',
        messageMetadata: {
          rawFinishReason: 'pause_turn',
          providerMetadata: { openai: { stopSequence: 'END' } }
        }
      },
      { type: 'finish', finishReason: 'stop' }
    ])
    expect(adapter.buildNonStreamingResponse()).toMatchObject({ stop_reason: 'end_turn', stop_sequence: null })
  })

  it.each(['priority', 'fast', 'ultrafast'])(
    'preserves a reported %s tier without turning filtered output into success',
    (tier) => {
      const adapter = new AiSdkToOpenAiResponsesSse({ model: 'test' })
      const output = events(adapter, [
        {
          type: 'message-metadata',
          messageMetadata: {
            providerMetadata: { openai: { serviceTier: tier } }
          }
        },
        { type: 'finish', finishReason: 'content-filter' }
      ])
      expect(output.at(-1)).toMatchObject({
        type: 'response.incomplete',
        response: { service_tier: tier, incomplete_details: { reason: 'content_filter' } }
      })
      expect(adapter.buildNonStreamingResponse()).toMatchObject({ status: 'incomplete', service_tier: tier })
    }
  )

  it('does not invent logprobs or service tier from ordinary model text', () => {
    const adapter = new AiSdkToOpenAiResponsesSse({ model: 'test' })
    events(adapter, [
      { type: 'text-delta', id: 'text', delta: 'service_tier: priority; logprob: -0.1' },
      { type: 'finish', finishReason: 'stop' }
    ])
    const output = adapter.buildNonStreamingResponse()
    expect(output).not.toHaveProperty('service_tier')
    const message = output.output.find((item) => item.type === 'message')
    expect(message?.content[0]).not.toHaveProperty('logprobs')
  })
})

it('retains a native Anthropic context-window limit while preserving length semantics', () => {
  const adapter = new AiSdkToAnthropicSse({ model: 'test' })
  const output = events(adapter, [
    {
      type: 'message-metadata',
      messageMetadata: {
        rawFinishReason: 'model_context_window_exceeded',
        providerMetadata: { anthropic: { stopSequence: null } }
      }
    },
    { type: 'finish', finishReason: 'length' }
  ])
  expect(output.find((event) => event.type === 'message_delta')).toMatchObject({
    delta: { stop_reason: 'model_context_window_exceeded' }
  })
  expect(adapter.buildNonStreamingResponse()).toMatchObject({ stop_reason: 'model_context_window_exceeded' })
})
