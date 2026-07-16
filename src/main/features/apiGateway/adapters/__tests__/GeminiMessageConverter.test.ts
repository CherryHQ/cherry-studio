import type { Provider } from '@shared/data/types/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Control which provider-family branch the thinking mapper takes.
vi.mock('@shared/utils/provider', () => ({
  isAnthropicProvider: vi.fn(() => false),
  isGeminiProvider: vi.fn(() => false),
  isOpenAIProvider: vi.fn(() => false),
  isAwsBedrockProvider: vi.fn(() => false)
}))

import { isGeminiProvider } from '@shared/utils/provider'

import { type GeminiGenerateContentRequest, GeminiMessageConverter } from '../converters/GeminiMessageConverter'

const converter = new GeminiMessageConverter()
const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const provider = (id = 'p'): Provider => ({ id }) as Provider

const request = (overrides: Partial<GeminiGenerateContentRequest>): GeminiGenerateContentRequest => ({
  contents: [],
  ...overrides
})

beforeEach(() => {
  asMock(isGeminiProvider).mockReturnValue(false)
})

describe('GeminiMessageConverter.toUIMessages', () => {
  it('emits a leading system message from a string systemInstruction', () => {
    const msgs = converter.toUIMessages(
      request({
        systemInstruction: 'Be terse.',
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }]
      })
    )
    expect(msgs[0]).toMatchObject({ role: 'system', parts: [{ type: 'text', text: 'Be terse.' }] })
    expect(msgs[1]).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'hi' }] })
  })

  it('joins a structured (parts) systemInstruction', () => {
    const msgs = converter.toUIMessages(
      request({
        systemInstruction: { parts: [{ text: 'A' }, { text: 'B' }] },
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }]
      })
    )
    expect(msgs[0]).toMatchObject({ role: 'system', parts: [{ type: 'text', text: 'A\nB' }] })
  })

  it('maps text, inlineData and fileData parts', () => {
    const msgs = converter.toUIMessages(
      request({
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'look' },
              { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
              { fileData: { mimeType: 'application/pdf', fileUri: 'gs://bucket/f.pdf' } }
            ]
          }
        ]
      })
    )
    expect(msgs[0].parts).toEqual([
      { type: 'text', text: 'look' },
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' },
      { type: 'file', mediaType: 'application/pdf', url: 'gs://bucket/f.pdf' }
    ])
  })

  it('maps a thought part to a reasoning part', () => {
    const msgs = converter.toUIMessages(
      request({ contents: [{ role: 'model', parts: [{ text: 'hmm', thought: true }] }] })
    )
    expect(msgs[0]).toMatchObject({ role: 'assistant', parts: [{ type: 'reasoning', text: 'hmm' }] })
  })

  it('folds a functionResponse into the matching functionCall (matched by name)', () => {
    const msgs = converter.toUIMessages(
      request({
        contents: [
          { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: 'SF' } } }] },
          { role: 'user', parts: [{ functionResponse: { name: 'get_weather', response: { temp: 20 } } }] }
        ]
      })
    )
    expect(msgs[0].parts[0]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'get_weather',
      state: 'output-available',
      input: { city: 'SF' },
      output: JSON.stringify({ temp: 20 })
    })
    // The user message held only the absorbed functionResponse → no message emitted.
    expect(msgs).toHaveLength(1)
  })

  it('relocates multimodal functionResponse parts into user file parts and keeps placeholders in the output', () => {
    const msgs = converter.toUIMessages(
      request({
        contents: [
          { role: 'model', parts: [{ functionCall: { id: 'c1', name: 'generate_image', args: {} } }] },
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  id: 'c1',
                  name: 'generate_image',
                  response: { status: 'done' },
                  parts: [
                    { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
                    { fileData: { mimeType: 'image/jpeg', fileUri: 'https://img.example/x.jpg' } }
                  ]
                }
              }
            ]
          }
        ]
      })
    )
    const output = (msgs[0].parts[0] as { output?: unknown }).output
    expect(output).toContain(JSON.stringify({ status: 'done' }))
    expect(output).toContain('[media 1 (image/png)')
    expect(output).toContain('[media 2 (image/jpeg)')
    expect(output).not.toContain('AAAA')
    expect(msgs[1]).toMatchObject({
      role: 'user',
      parts: [
        { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' },
        { type: 'file', mediaType: 'image/jpeg', url: 'https://img.example/x.jpg' }
      ]
    })
  })

  it('pairs parallel same-name id-less calls 1:1 by document order (no cross-contamination)', () => {
    // Gemini 1.5/2.0/2.5 `generateContent` often omits ids; two `get_weather`
    // calls in one round must each keep their OWN response, not both read the last.
    const msgs = converter.toUIMessages(
      request({
        contents: [
          {
            role: 'model',
            parts: [
              { functionCall: { name: 'get_weather', args: { city: 'Tokyo' } } },
              { functionCall: { name: 'get_weather', args: { city: 'Paris' } } }
            ]
          },
          {
            role: 'user',
            parts: [
              { functionResponse: { name: 'get_weather', response: { temp: 'sunny' } } },
              { functionResponse: { name: 'get_weather', response: { temp: 'rainy' } } }
            ]
          }
        ]
      })
    )
    expect(msgs).toHaveLength(1)
    expect(msgs[0].parts[0]).toMatchObject({
      type: 'dynamic-tool',
      state: 'output-available',
      input: { city: 'Tokyo' },
      output: JSON.stringify({ temp: 'sunny' })
    })
    expect(msgs[0].parts[1]).toMatchObject({
      type: 'dynamic-tool',
      state: 'output-available',
      input: { city: 'Paris' },
      output: JSON.stringify({ temp: 'rainy' })
    })
  })

  it('pairs calls to responses by explicit id regardless of response order (Gemini 3)', () => {
    const msgs = converter.toUIMessages(
      request({
        contents: [
          {
            role: 'model',
            parts: [
              { functionCall: { id: 'c1', name: 'get_weather', args: { city: 'Tokyo' } } },
              { functionCall: { id: 'c2', name: 'get_weather', args: { city: 'Paris' } } }
            ]
          },
          {
            role: 'user',
            parts: [
              // Responses deliberately reversed — id pairing must ignore position.
              { functionResponse: { id: 'c2', name: 'get_weather', response: { temp: 'rainy' } } },
              { functionResponse: { id: 'c1', name: 'get_weather', response: { temp: 'sunny' } } }
            ]
          }
        ]
      })
    )
    expect(msgs[0].parts[0]).toMatchObject({
      toolCallId: 'c1',
      input: { city: 'Tokyo' },
      output: JSON.stringify({ temp: 'sunny' })
    })
    expect(msgs[0].parts[1]).toMatchObject({
      toolCallId: 'c2',
      input: { city: 'Paris' },
      output: JSON.stringify({ temp: 'rainy' })
    })
  })

  it('emits an input-available tool part when the call has no response yet', () => {
    const msgs = converter.toUIMessages(
      request({ contents: [{ role: 'model', parts: [{ functionCall: { name: 'search', args: { q: 'x' } } }] }] })
    )
    expect(msgs[0].parts[0]).toMatchObject({ type: 'dynamic-tool', toolName: 'search', state: 'input-available' })
  })

  // Gemini 3 requires the model's thoughtSignature echoed back on the next turn; carry it
  // through AI SDK provider metadata so the Google provider re-sends it (else HTTP 400).
  it('round-trips a functionCall thoughtSignature into callProviderMetadata', () => {
    const msgs = converter.toUIMessages(
      request({
        contents: [
          {
            role: 'model',
            parts: [{ functionCall: { id: 'c1', name: 'search', args: { q: 'x' } }, thoughtSignature: 'sig-abc' }]
          }
        ]
      })
    )
    expect(msgs[0].parts[0]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'search',
      callProviderMetadata: { google: { thoughtSignature: 'sig-abc' } }
    })
  })

  it('round-trips a thought part thoughtSignature into providerMetadata', () => {
    const msgs = converter.toUIMessages(
      request({ contents: [{ role: 'model', parts: [{ text: 'hmm', thought: true, thoughtSignature: 'sig-xyz' }] }] })
    )
    expect(msgs[0].parts[0]).toMatchObject({
      type: 'reasoning',
      text: 'hmm',
      providerMetadata: { google: { thoughtSignature: 'sig-xyz' } }
    })
  })

  it('round-trips a plain text part thoughtSignature into providerMetadata', () => {
    const msgs = converter.toUIMessages(
      request({ contents: [{ role: 'model', parts: [{ text: 'answer', thoughtSignature: 'sig-txt' }] }] })
    )
    expect(msgs[0].parts[0]).toMatchObject({
      type: 'text',
      text: 'answer',
      providerMetadata: { google: { thoughtSignature: 'sig-txt' } }
    })
  })

  it('attaches no metadata to a signature-less functionCall (no empty callProviderMetadata)', () => {
    const msgs = converter.toUIMessages(
      request({ contents: [{ role: 'model', parts: [{ functionCall: { name: 'search', args: { q: 'x' } } }] }] })
    )
    expect(msgs[0].parts[0]).not.toHaveProperty('callProviderMetadata')
  })
})

describe('GeminiMessageConverter.toAiSdkTools', () => {
  it('returns undefined when there are no tools', () => {
    expect(converter.toAiSdkTools(request({}))).toBeUndefined()
  })

  it('builds a ToolSet from functionDeclarations (parametersJsonSchema)', () => {
    const tools = converter.toAiSdkTools(
      request({
        tools: [
          {
            functionDeclarations: [
              {
                name: 'get_weather',
                description: 'Get weather',
                parametersJsonSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }
              }
            ]
          }
        ]
      })
    )
    expect(tools && Object.keys(tools)).toEqual(['get_weather'])
  })

  it('normalizes Gemini `parameters` (UPPERCASE type) into a usable tool', () => {
    const tools = converter.toAiSdkTools(
      request({
        tools: [
          {
            functionDeclarations: [
              { name: 'lookup', parameters: { type: 'OBJECT', properties: { id: { type: 'STRING' } } } }
            ]
          }
        ]
      })
    )
    expect(tools && Object.keys(tools)).toEqual(['lookup'])
  })

  it('skips built-in tools that carry no functionDeclarations', () => {
    const tools = converter.toAiSdkTools(request({ tools: [{} as never] }))
    expect(tools).toBeUndefined()
  })
})

describe('GeminiMessageConverter.extractStreamOptions', () => {
  it('reads sampling options from generationConfig', () => {
    expect(
      converter.extractStreamOptions(
        request({
          generationConfig: { temperature: 0.5, topP: 0.9, topK: 40, maxOutputTokens: 128, stopSequences: ['x'] }
        })
      )
    ).toEqual({ temperature: 0.5, topP: 0.9, topK: 40, maxOutputTokens: 128, stopSequences: ['x'] })
  })

  it('returns undefined fields when generationConfig is absent', () => {
    expect(converter.extractStreamOptions(request({}))).toEqual({
      temperature: undefined,
      topP: undefined,
      topK: undefined,
      maxOutputTokens: undefined,
      stopSequences: undefined
    })
  })
})

describe('GeminiMessageConverter.extractProviderOptions', () => {
  it('returns undefined when there is no thinkingConfig', () => {
    expect(converter.extractProviderOptions(provider(), request({}))).toBeUndefined()
  })

  it('maps an enabled thinkingConfig via the shared thinking mapper', () => {
    asMock(isGeminiProvider).mockReturnValue(true)
    const options = converter.extractProviderOptions(
      provider(),
      request({ generationConfig: { thinkingConfig: { includeThoughts: true, thinkingBudget: 512 } } })
    )
    expect(options).toEqual({ google: { thinkingConfig: { thinkingBudget: 512, includeThoughts: true } } })
  })

  it('preserves a dynamic thinkingBudget (-1) for a Gemini target instead of inverting it to 0', () => {
    asMock(isGeminiProvider).mockReturnValue(true)
    const options = converter.extractProviderOptions(
      provider(),
      request({ generationConfig: { thinkingConfig: { thinkingBudget: -1 } } })
    )
    expect(options).toEqual({ google: { thinkingConfig: { thinkingBudget: -1 } } })
  })
})
