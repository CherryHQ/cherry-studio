import { describe, expect, it } from 'vitest'

import type OpenAI from '@cherrystudio/openai'

import {
  OpenAiResponsesMessageConverter,
  type ResponsesCreateParams
} from '../converters/OpenAiResponsesMessageConverter'
import { AiSdkToOpenAiResponsesSse } from '../stream/AiSdkToOpenAiResponsesSse'

const converter = new OpenAiResponsesMessageConverter()

const params = (overrides: Partial<ResponsesCreateParams>): ResponsesCreateParams => ({
  model: 'openai:gpt-4',
  ...overrides
})

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

  it.each(['streaming', 'non-streaming'] as const)(
    'preserves the assistant answer when replaying %s gateway output with reasoning and a tool result',
    (mode) => {
      const adapter = new AiSdkToOpenAiResponsesSse({ model: 'openai:gpt-4' })
      adapter.transformChunk({
        type: 'reasoning-delta',
        id: 'r1',
        delta: 'Remember the token before looking up weather.'
      })
      adapter.transformChunk({ type: 'reasoning-end', id: 'r1' })
      adapter.transformChunk({ type: 'text-delta', id: 't1', delta: 'The token is BLUE-739.' })
      adapter.transformChunk({
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'get_weather',
        input: { city: 'SF' }
      })
      adapter.transformChunk({ type: 'finish', finishReason: 'tool-calls' })
      const completed = adapter.finalizeEvents().find((event) => event.type === 'response.completed')
      expect(completed).toBeDefined()
      const response = mode === 'streaming' ? completed!.response : adapter.buildNonStreamingResponse()

      const msgs = converter.toUIMessages(
        params({
          input: [
            { role: 'user', content: 'Choose a token, then check the weather.' },
            ...response.output,
            { type: 'function_call_output', call_id: 'c1', output: '72F' },
            { role: 'user', content: 'What was the token you chose?' }
          ]
        })
      )

      expect(msgs.map(({ role, parts }) => ({ role, parts }))).toEqual([
        { role: 'user', parts: [{ type: 'text', text: 'Choose a token, then check the weather.' }] },
        { role: 'assistant', parts: [{ type: 'reasoning', text: 'Remember the token before looking up weather.' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'The token is BLUE-739.' }] },
        {
          role: 'assistant',
          parts: [
            {
              type: 'dynamic-tool',
              toolName: 'get_weather',
              toolCallId: 'c1',
              state: 'output-available',
              input: { city: 'SF' },
              output: '72F'
            }
          ]
        },
        { role: 'user', parts: [{ type: 'text', text: 'What was the token you chose?' }] }
      ])
    }
  )

  it('preserves every output_text part in order when replaying an output message', () => {
    const message: OpenAI.Responses.ResponseOutputMessage = {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      status: 'completed',
      content: [
        { type: 'output_text', text: 'First paragraph.', annotations: [] },
        { type: 'output_text', text: 'Second paragraph.', annotations: [] }
      ]
    }
    expect(converter.toUIMessages(params({ input: [message] }))).toMatchObject([
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: 'First paragraph.' },
          { type: 'text', text: 'Second paragraph.' }
        ]
      }
    ])
  })

  it.each(['The token is BLUE-739.', [{ type: 'input_text' as const, text: 'The token is BLUE-739.' }]])(
    'continues to accept assistant EasyInputMessage content: %j',
    (content) => {
      expect(converter.toUIMessages(params({ input: [{ role: 'assistant', content }] }))).toMatchObject([
        { role: 'assistant', parts: [{ type: 'text', text: 'The token is BLUE-739.' }] }
      ])
    }
  )

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

  it('relocates function_call_output images into a user message and keeps placeholders in the output', () => {
    const msgs = converter.toUIMessages(
      params({
        input: [
          { type: 'function_call', call_id: 'c1', name: 'generate_image', arguments: '{}' },
          {
            type: 'function_call_output',
            call_id: 'c1',
            output: [
              { type: 'input_text', text: 'done' },
              { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }
            ]
          }
        ] as ResponsesCreateParams['input']
      })
    )
    const output = (msgs[0].parts[0] as { output?: unknown }).output
    expect(output).toContain('done')
    expect(output).toContain('[tool-result attachment call_id="c1" image=1] (image/png)')
    expect(output).not.toContain('AAAA')
    expect(msgs[1]).toMatchObject({
      role: 'user',
      parts: [
        { type: 'text', text: expect.stringContaining('call_id="c1"') },
        { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' }
      ]
    })
  })

  it('keeps call ids attached to relocated files when parallel outputs arrive out of order', () => {
    const msgs = converter.toUIMessages(
      params({
        input: [
          { type: 'function_call', call_id: 'c1', name: 'generate_image', arguments: '{"prompt":"first"}' },
          { type: 'function_call', call_id: 'c2', name: 'generate_image', arguments: '{"prompt":"second"}' },
          {
            type: 'function_call_output',
            call_id: 'c2',
            output: [{ type: 'input_image', image_url: 'data:image/png;base64,BBBB' }]
          },
          {
            type: 'function_call_output',
            call_id: 'c1',
            output: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }]
          }
        ] as ResponsesCreateParams['input']
      })
    )

    expect((msgs[0].parts[0] as { output?: string }).output).toContain('call_id="c1"')
    expect((msgs[1].parts[0] as { output?: string }).output).toContain('call_id="c2"')
    expect(msgs[2].parts).toEqual([
      { type: 'text', text: expect.stringContaining('call_id="c2"') },
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,BBBB' }
    ])
    expect(msgs[3].parts).toEqual([
      { type: 'text', text: expect.stringContaining('call_id="c1"') },
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' }
    ])
  })

  it('relocates input_file outputs (file_data and file_url) into user file parts, preserving filename', () => {
    const msgs = converter.toUIMessages(
      params({
        input: [
          { type: 'function_call', call_id: 'c1', name: 'export_report', arguments: '{}' },
          {
            type: 'function_call_output',
            call_id: 'c1',
            output: [
              { type: 'input_file', file_data: 'JVBERI', filename: 'report.pdf' },
              { type: 'input_file', file_url: 'https://files.example/doc.pdf' }
            ]
          }
        ] as ResponsesCreateParams['input']
      })
    )
    const output = (msgs[0].parts[0] as { output?: unknown }).output
    expect(output).toContain('[tool-result attachment call_id="c1" file=1] (application/pdf, report.pdf)')
    expect(output).toContain('[tool-result attachment call_id="c1" file=2] (application/pdf)')
    expect(output).not.toContain('JVBERI')
    expect(msgs[1]).toMatchObject({
      role: 'user',
      parts: [
        { type: 'text', text: expect.stringContaining('call_id="c1"') },
        {
          type: 'file',
          mediaType: 'application/pdf',
          url: 'data:application/pdf;base64,JVBERI',
          filename: 'report.pdf'
        },
        { type: 'text', text: expect.stringContaining('call_id="c1"') },
        { type: 'file', mediaType: 'application/pdf', url: 'https://files.example/doc.pdf' }
      ]
    })
  })

  it('downgrades file_id-only input_file outputs to a placeholder (not resolvable cross-vendor)', () => {
    const msgs = converter.toUIMessages(
      params({
        input: [
          { type: 'function_call', call_id: 'c1', name: 'export_report', arguments: '{}' },
          {
            type: 'function_call_output',
            call_id: 'c1',
            output: [{ type: 'input_file', file_id: 'file-abc' }]
          }
        ] as ResponsesCreateParams['input']
      })
    )
    expect((msgs[0].parts[0] as { output?: unknown }).output).toContain(
      '[unsupported input_file tool output item omitted]'
    )
    expect(msgs).toHaveLength(1)
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

  it('maps an echoed reasoning item to an assistant reasoning part, ahead of the call it preceded', () => {
    const msgs = converter.toUIMessages(
      params({
        input: [
          { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'weigh options' }] },
          { type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' }
        ] as ResponsesCreateParams['input']
      })
    )
    expect(msgs[0]).toMatchObject({ role: 'assistant', parts: [{ type: 'reasoning', text: 'weigh options' }] })
    expect(msgs[1]?.parts[0]).toMatchObject({ type: 'dynamic-tool', toolCallId: 'c1' })
  })

  it('prefers reasoning_text content over summary, and skips an item carrying neither', () => {
    const msgs = converter.toUIMessages(
      params({
        input: [
          {
            type: 'reasoning',
            id: 'rs_1',
            summary: [{ type: 'summary_text', text: 'short' }],
            content: [{ type: 'reasoning_text', text: 'the raw chain' }]
          },
          { type: 'reasoning', id: 'rs_2', summary: [], encrypted_content: 'opaque' }
        ] as ResponsesCreateParams['input']
      })
    )
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ parts: [{ type: 'reasoning', text: 'the raw chain' }] })
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
