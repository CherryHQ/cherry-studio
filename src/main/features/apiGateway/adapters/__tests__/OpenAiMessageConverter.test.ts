import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it } from 'vitest'

import { type ExtendedChatCompletionCreateParams, OpenAiMessageConverter } from '../converters/OpenAiMessageConverter'

const converter = new OpenAiMessageConverter()

/** Build a minimal valid params object; spread overrides the fields under test. */
const params = (overrides: Partial<ExtendedChatCompletionCreateParams>): ExtendedChatCompletionCreateParams => ({
  model: 'provider:model',
  messages: [],
  ...overrides
})

describe('OpenAiMessageConverter', () => {
  it('maps a developer message to a system UIMessage instead of dropping it', () => {
    const messages = converter.toUIMessages(params({ messages: [{ role: 'developer', content: 'Be terse.' }] }))
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('system')
    expect(messages[0].parts).toEqual([{ type: 'text', text: 'Be terse.' }])
  })

  it('prefers max_completion_tokens over the legacy max_tokens, falling back when absent', () => {
    expect(converter.extractStreamOptions(params({ max_completion_tokens: 100, max_tokens: 50 })).maxOutputTokens).toBe(
      100
    )
    expect(converter.extractStreamOptions(params({ max_tokens: 50 })).maxOutputTokens).toBe(50)
    expect(converter.extractStreamOptions(params({})).maxOutputTokens).toBeUndefined()
  })

  it.each(['', null])('replays a zero-arg tool call with arguments %j as an empty input object', (args) => {
    const messages = converter.toUIMessages(
      params({
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'get_time', arguments: args as unknown as string } }
            ]
          },
          { role: 'tool', tool_call_id: 'c1', content: '12:00' }
        ]
      })
    )
    expect(messages[0].parts).toEqual([
      {
        type: 'dynamic-tool',
        toolName: 'get_time',
        toolCallId: 'c1',
        state: 'output-available',
        input: {},
        output: '12:00'
      }
    ])
  })
})

describe('OpenAiMessageConverter.toAiSdkTools blank names', () => {
  beforeEach(() => {
    mockMainLoggerService.warn.mockClear()
  })

  it('drops blank function names and warns once with original request locations', () => {
    const tools = converter.toAiSdkTools(
      params({
        tools: [
          { type: 'function', function: { name: '', description: 'empty' } },
          { type: 'function', function: { name: 'lookup' } },
          { type: 'function', function: { name: '   ', description: 'spaces' } },
          { type: 'function', function: { name: 'clock' } },
          { type: 'function', function: { name: '\t\n' } }
        ]
      })
    )

    expect.soft(Object.keys(tools ?? {})).toEqual(['lookup', 'clock'])
    expect
      .soft(mockMainLoggerService.warn)
      .toHaveBeenCalledExactlyOnceWith('Dropped tools with empty or whitespace-only names before provider request', {
        inputFormat: 'openai',
        model: params({}).model,
        droppedTools: [
          { index: 0, path: 'tools[0].function.name', name: '', description: 'empty' },
          { index: 2, path: 'tools[2].function.name', name: '   ', description: 'spaces' },
          { index: 4, path: 'tools[4].function.name', name: '\t\n', description: undefined }
        ]
      })
  })

  it('drops entries whose name is not a string (missing/null)', () => {
    const tools = converter.toAiSdkTools(
      params({
        tools: [
          { type: 'function', function: { name: undefined } },
          { type: 'function', function: { name: 'lookup' } },
          { type: 'function', function: { name: null } }
        ] as unknown as ExtendedChatCompletionCreateParams['tools']
      })
    )

    expect(Object.keys(tools ?? {})).toEqual(['lookup'])
    expect(mockMainLoggerService.warn).toHaveBeenCalledExactlyOnceWith(
      'Dropped tools with empty or whitespace-only names before provider request',
      {
        inputFormat: 'openai',
        model: params({}).model,
        droppedTools: [
          { index: 0, path: 'tools[0].function.name', name: undefined, description: undefined },
          { index: 2, path: 'tools[2].function.name', name: null, description: undefined }
        ]
      }
    )
  })

  it('returns undefined when every function name is blank', () => {
    const tools = converter.toAiSdkTools(
      params({
        tools: [
          { type: 'function', function: { name: '' } },
          { type: 'function', function: { name: '   ' } },
          { type: 'function', function: { name: '\t\n' } }
        ]
      })
    )

    expect.soft(tools).toBeUndefined()
    expect
      .soft(mockMainLoggerService.warn)
      .toHaveBeenCalledExactlyOnceWith('Dropped tools with empty or whitespace-only names before provider request', {
        inputFormat: 'openai',
        model: params({}).model,
        droppedTools: [
          { index: 0, path: 'tools[0].function.name', name: '', description: undefined },
          { index: 1, path: 'tools[1].function.name', name: '   ', description: undefined },
          { index: 2, path: 'tools[2].function.name', name: '\t\n', description: undefined }
        ]
      })
  })

  it('preserves retained tool names and definitions while filtering blank entries', () => {
    const schema = { type: 'object' as const, properties: { city: { type: 'string' } }, required: ['city'] }
    const tools = converter.toAiSdkTools(
      params({
        tools: [
          {
            type: 'function',
            function: { name: ' lookup ', description: 'Find a city', parameters: schema, strict: false }
          },
          { type: 'function', function: { name: '' } },
          {
            type: 'function',
            function: {
              name: 'clock',
              description: 'Read the clock',
              parameters: { type: 'object', properties: {} },
              strict: true
            }
          }
        ]
      })
    )

    expect.soft(Object.keys(tools ?? {})).toEqual([' lookup ', 'clock'])
    expect(tools?.[' lookup ']).toMatchObject({ description: 'Find a city', strict: false })
    expect(tools?.[' lookup '].inputSchema).toHaveProperty('jsonSchema', schema)
    expect(tools?.clock).toMatchObject({ description: 'Read the clock', strict: true })
    expect(tools?.clock.inputSchema).toHaveProperty('jsonSchema', { type: 'object', properties: {} })
  })

  it.each([undefined, [], [{ type: 'function' as const, function: { name: 'lookup' } }]])(
    'does not warn when no names are dropped (%j)',
    (tools) => {
      const result = converter.toAiSdkTools(params({ tools }))
      expect(result ? Object.keys(result) : undefined).toEqual(tools?.length ? ['lookup'] : undefined)
      expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
    }
  )
})
