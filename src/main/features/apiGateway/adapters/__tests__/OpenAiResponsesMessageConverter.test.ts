import { describe, expect, it } from 'vitest'

import {
  OpenAiResponsesMessageConverter,
  type ResponsesCreateParams
} from '../converters/OpenAiResponsesMessageConverter'

const converter = new OpenAiResponsesMessageConverter()

const params = (overrides: Partial<ResponsesCreateParams>): ResponsesCreateParams =>
  ({ model: 'openai:gpt-4', ...overrides }) as ResponsesCreateParams

describe('OpenAiResponsesMessageConverter.toUIMessages', () => {
  it('emits a leading system message from instructions and a user message from a string input', () => {
    const msgs = converter.toUIMessages(params({ instructions: 'Be terse.', input: 'hi' }))
    expect(msgs[0]).toMatchObject({ role: 'system', parts: [{ type: 'text', text: 'Be terse.' }] })
    expect(msgs[1]).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'hi' }] })
  })

  it('converts EasyInputMessage roles (developer → system, user text + image)', () => {
    const msgs = converter.toUIMessages(
      params({
        input: [
          { role: 'developer', content: 'sys' },
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'look' },
              { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'auto' }
            ]
          }
        ] as ResponsesCreateParams['input']
      })
    )
    expect(msgs[0]).toMatchObject({ role: 'system', parts: [{ type: 'text', text: 'sys' }] })
    expect(msgs[1].role).toBe('user')
    expect(msgs[1].parts).toEqual([
      { type: 'text', text: 'look' },
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' }
    ])
  })

  it('pairs a function_call with its function_call_output into an output-available part', () => {
    const msgs = converter.toUIMessages(
      params({
        input: [
          { type: 'function_call', call_id: 'c1', name: 'get_weather', arguments: '{"city":"SF"}' },
          { type: 'function_call_output', call_id: 'c1', output: '72F' }
        ] as ResponsesCreateParams['input']
      })
    )
    const part = msgs.find((m) => m.role === 'assistant')?.parts[0]
    expect(part).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'get_weather',
      toolCallId: 'c1',
      state: 'output-available',
      input: { city: 'SF' },
      output: '72F'
    })
  })

  it('emits an input-available part when a function_call has no output, and tolerates bad JSON args', () => {
    const msgs = converter.toUIMessages(
      params({
        input: [
          { type: 'function_call', call_id: 'c2', name: 'f', arguments: 'not-json' }
        ] as ResponsesCreateParams['input']
      })
    )
    const part = msgs.find((m) => m.role === 'assistant')?.parts[0]
    expect(part).toMatchObject({ type: 'dynamic-tool', state: 'input-available', input: { raw: 'not-json' } })
  })

  it('returns an empty list when there is no input', () => {
    expect(converter.toUIMessages(params({}))).toEqual([])
  })
})

describe('OpenAiResponsesMessageConverter.toAiSdkTools', () => {
  it('builds a ToolSet from function tools and skips non-function tools', () => {
    const tools = converter.toAiSdkTools(
      params({
        tools: [
          { type: 'function', name: 'get_weather', parameters: { type: 'object', properties: {} }, strict: false },
          { type: 'web_search_preview' }
        ] as ResponsesCreateParams['tools']
      })
    )
    expect(Object.keys(tools ?? {})).toEqual(['get_weather'])
  })

  it('returns undefined when there are no tools', () => {
    expect(converter.toAiSdkTools(params({}))).toBeUndefined()
  })
})

describe('OpenAiResponsesMessageConverter.extractStreamOptions', () => {
  it('maps Responses sampling params to common options', () => {
    expect(converter.extractStreamOptions(params({ max_output_tokens: 200, temperature: 0.3, top_p: 0.8 }))).toEqual({
      maxOutputTokens: 200,
      temperature: 0.3,
      topP: 0.8
    })
  })
})
