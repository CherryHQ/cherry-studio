import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'
import { describe, expect, it, vi } from 'vitest'

import { AnthropicMessageConverter, type ReasoningCache } from '../converters/AnthropicMessageConverter'

const converter = new AnthropicMessageConverter()

const params = (overrides: Partial<MessageCreateParams>): MessageCreateParams =>
  ({ model: 'anthropic:claude', max_tokens: 1024, messages: [], ...overrides }) as MessageCreateParams

describe('AnthropicMessageConverter.toUIMessages', () => {
  it('emits a leading system message from a string system prompt', () => {
    const msgs = converter.toUIMessages(params({ system: 'Be terse.', messages: [{ role: 'user', content: 'hi' }] }))
    expect(msgs[0]).toMatchObject({ role: 'system', parts: [{ type: 'text', text: 'Be terse.' }] })
    expect(msgs[1]).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'hi' }] })
  })

  it('joins a structured (text-block) system prompt', () => {
    const msgs = converter.toUIMessages(
      params({
        system: [
          { type: 'text', text: 'A' },
          { type: 'text', text: 'B' }
        ] as MessageCreateParams['system'],
        messages: [{ role: 'user', content: 'hi' }]
      })
    )
    expect(msgs[0]).toMatchObject({ role: 'system', parts: [{ type: 'text', text: 'A\nB' }] })
  })

  it('converts text + base64 image blocks into text and file parts', () => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'look' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
            ]
          }
        ] as MessageCreateParams['messages']
      })
    )
    expect(msgs[0].parts).toEqual([
      { type: 'text', text: 'look' },
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' }
    ])
  })

  it('maps thinking and redacted_thinking blocks to reasoning parts', () => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'hmm', signature: 's' },
              { type: 'redacted_thinking', data: 'xxx' }
            ]
          }
        ] as MessageCreateParams['messages']
      })
    )
    expect(msgs[0].parts).toEqual([
      { type: 'reasoning', text: 'hmm' },
      { type: 'reasoning', text: 'xxx' }
    ])
  })

  it('pairs a tool_use with its later tool_result into an output-available part', () => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'SF' } }]
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '72F' }]
          }
        ] as MessageCreateParams['messages']
      })
    )
    expect(msgs[0].parts[0]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'get_weather',
      toolCallId: 'call_1',
      state: 'output-available',
      input: { city: 'SF' },
      output: '72F'
    })
  })

  it('emits an input-available tool part when there is no matching result', () => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'c2', name: 'f', input: {} }] }
        ] as MessageCreateParams['messages']
      })
    )
    expect(msgs[0].parts[0]).toMatchObject({ type: 'dynamic-tool', toolCallId: 'c2', state: 'input-available' })
  })

  it('reconstructs OpenRouter reasoning_details onto the tool call from the cache', () => {
    const details = [{ type: 'reasoning.text', text: 'because' }]
    const openRouterReasoningCache: ReasoningCache = { get: vi.fn(() => details), set: vi.fn() }
    const c = new AnthropicMessageConverter({ openRouterReasoningCache })
    const msgs = c.toUIMessages(
      params({
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'c3', name: 'f', input: {} }] }
        ] as MessageCreateParams['messages']
      })
    )
    expect(openRouterReasoningCache.get).toHaveBeenCalledWith('openrouter-c3')
    expect((msgs[0].parts[0] as { callProviderMetadata?: unknown }).callProviderMetadata).toMatchObject({
      openrouter: { reasoning_details: details }
    })
  })
})

describe('AnthropicMessageConverter.toAiSdkTools', () => {
  it('builds a ToolSet keyed by name and skips bash tools', () => {
    const tools = converter.toAiSdkTools(
      params({
        tools: [
          { name: 'get_weather', description: 'w', input_schema: { type: 'object', properties: {} } },
          { type: 'bash_20250124', name: 'bash' }
        ] as MessageCreateParams['tools']
      })
    )
    expect(Object.keys(tools ?? {})).toEqual(['get_weather'])
  })

  it('returns undefined when there are no tools', () => {
    expect(converter.toAiSdkTools(params({}))).toBeUndefined()
  })
})

describe('AnthropicMessageConverter tool_result media', () => {
  const withToolResult = (content: unknown) =>
    params({
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'shot', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content }] }
      ] as MessageCreateParams['messages']
    })

  const toolPartOutput = (p: MessageCreateParams) => {
    const msgs = converter.toUIMessages(p)
    const part = msgs.flatMap((m) => m.parts).find((x) => x.type === 'dynamic-tool') as { output?: unknown }
    return part.output
  }

  it('emits structured image-data for a nested tool_result image (not a base64 string)', () => {
    const output = toolPartOutput(
      withToolResult([
        { type: 'text', text: 'here' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
      ])
    )
    expect(output).toEqual([
      { type: 'text', text: 'here' },
      { type: 'image-data', data: 'AAAA', mediaType: 'image/png' }
    ])
    expect(JSON.stringify(output)).not.toContain('data:image/png;base64')
  })

  it('emits image-url for a url-sourced nested image', () => {
    const output = toolPartOutput(withToolResult([{ type: 'image', source: { type: 'url', url: 'https://x/y.png' } }]))
    expect(output).toEqual([{ type: 'image-url', url: 'https://x/y.png' }])
  })

  it('keeps a text-only tool_result as a joined string (unchanged)', () => {
    expect(
      toolPartOutput(
        withToolResult([
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' }
        ])
      )
    ).toBe('a\nb')
  })
})

describe('AnthropicMessageConverter.toAiSdkTools toModelOutput', () => {
  it('maps an items array → content, a string → text, an object → json', () => {
    const tools = converter.toAiSdkTools(
      params({
        tools: [{ name: 'shot', description: 'd', input_schema: { type: 'object' } }] as MessageCreateParams['tools']
      })
    )
    const toModelOutput = (
      tools?.['shot'] as unknown as {
        toModelOutput: (o: { toolCallId: string; input: unknown; output: unknown }) => unknown
      }
    ).toModelOutput
    const call = (output: unknown) => toModelOutput({ toolCallId: 't', input: {}, output })
    expect(call([{ type: 'text', text: 'x' }])).toEqual({ type: 'content', value: [{ type: 'text', text: 'x' }] })
    expect(call('hi')).toEqual({ type: 'text', value: 'hi' })
    expect(call({ a: 1 })).toEqual({ type: 'json', value: { a: 1 } })
  })
})

describe('AnthropicMessageConverter.extractStreamOptions', () => {
  it('maps Anthropic sampling params to common options', () => {
    expect(
      converter.extractStreamOptions(
        params({ max_tokens: 256, temperature: 0.5, top_p: 0.9, top_k: 40, stop_sequences: ['x'] })
      )
    ).toEqual({ maxOutputTokens: 256, temperature: 0.5, topP: 0.9, topK: 40, stopSequences: ['x'] })
  })
})
