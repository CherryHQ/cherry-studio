import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { wrapLanguageModel } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'

import { collectFromFeatures } from '../../collectFromFeatures'
import type { RequestScope } from '../../scope'
import { createGeminiThoughtSignatureReplayMiddleware } from '../geminiThoughtSignatureReplay'
import { INTERNAL_FEATURES } from '../internalFeatures'
import { skipGeminiThoughtSignatureFeature } from '../skipGeminiThoughtSignature'

vi.mock('@cherrystudio/ai-core/built-in/plugins', () => ({
  providerToolPlugin: vi.fn((kind: string) => ({ name: `provider-tool-${kind}` }))
}))

const key = '11111111-1111-4111-8111-111111111111'
const sentinel = 'skip_thought_signature_validator'

async function registeredWire(modelId: string, endpointType: string, prompt: any[]) {
  const scope = {
    request: { conversation: { id: 'test' }, mcpToolIds: [] },
    registry: {},
    model: { id: `test::${modelId}`, apiModelId: modelId, name: modelId },
    provider: { id: 'foreign', settings: {} },
    sdkConfig: { providerId: 'openai', providerOptionsKey: key, providerSettings: {}, modelId },
    endpointType,
    aiSdkProviderId: 'openai-compatible',
    reasoningProfile: { format: 'none', wire: { disabled: true } },
    reasoning: { kind: 'omit', selection: 'default', emissions: [] },
    requestContext: { requestId: 'req-1', abortSignal: new AbortController().signal },
    mcpToolIds: new Set(),
    contextSettings: DEFAULT_CONTEXT_SETTINGS,
    compressionModel: null
  } as unknown as RequestScope
  const adapters = collectFromFeatures(scope, INTERNAL_FEATURES).modelAdapters.filter((plugin) =>
    ['gemini-thought-signature-replay', 'skip-gemini-thought-signature'].includes(plugin.name)
  )
  const context: any = { middlewares: [] }
  for (const plugin of adapters) await plugin.configureContext!(context)
  let body: any
  const model = createOpenAICompatible({
    name: key,
    baseURL: 'https://example.test',
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        id: 'id',
        created: 1,
        model: modelId,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
      })
    }
  })(modelId)
  await wrapLanguageModel({ model, middleware: context.middlewares }).doGenerate({ prompt })
  expect(body).toBeDefined()
  expect(body.messages[0].tool_calls).toHaveLength(
    prompt[0].content.filter((part: any) => part.type === 'tool-call').length
  )
  return { body, names: adapters.map((plugin) => plugin.name) }
}

const toolCall = (id: string, providerOptions?: any) => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: 'lookup',
  input: {},
  providerOptions
})

async function wire(options: any[], stream = false) {
  let body: any
  const model = createOpenAICompatible({
    name: key,
    baseURL: 'https://example.test',
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      if (stream) return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
      return Response.json({
        id: 'id',
        created: 1,
        model: 'gemini',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
      })
    }
  })('gemini-4-argon')
  const context: any = { middlewares: [] }
  await skipGeminiThoughtSignatureFeature.contributeModelAdapters!({} as any)[0].configureContext!(context)
  const wrapped = wrapLanguageModel({
    model,
    middleware: [createGeminiThoughtSignatureReplayMiddleware(key), ...context.middlewares]
  })
  const prompt: any = [
    {
      role: 'assistant',
      content: options.map((providerOptions, i) => ({
        type: 'tool-call',
        toolCallId: `call_${i}`,
        toolName: 'lookup',
        input: { i },
        providerOptions
      }))
    }
  ]
  const freeze = (value: any) => {
    if (value && typeof value === 'object') {
      Object.freeze(value)
      Object.values(value).forEach(freeze)
    }
  }
  freeze(prompt)
  if (stream) await wrapped.doStream({ prompt })
  else await wrapped.doGenerate({ prompt })
  return body.messages[0].tool_calls
}
const source = (value: any) => ({ [key]: { thoughtSignature: value } })
const wireOption = (value: any) => ({
  extra_content: { sibling: 'keep', google: { marker: 'keep', thought_signature: value } }
})

describe('compatible Gemini signature replay wire', () => {
  it.each(['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'])(
    'AC3 sends a sentinel through the registered chain for %s',
    async (modelId) => {
      const { body, names } = await registeredWire(modelId, 'openai-chat-completions', [
        { role: 'assistant', content: [toolCall('call')] }
      ])
      expect(names).toEqual(['gemini-thought-signature-replay', 'skip-gemini-thought-signature'])
      expect(body.messages[0].tool_calls[0].extra_content.google.thought_signature).toBe(sentinel)
    }
  )

  it('AC13 does not emit a signature for gpt-4 on openai-chat-completions', async () => {
    const { body } = await registeredWire('gpt-4', 'openai-chat-completions', [
      { role: 'assistant', content: [toolCall('call')] }
    ])
    expect(body.messages[0].tool_calls[0].extra_content?.google?.thought_signature).toBeUndefined()
  })

  it('AC13 does not register replay for gemini-4-argon on openai-responses', async () => {
    const { names } = await registeredWire('gemini-4-argon', 'openai-responses', [
      { role: 'assistant', content: [toolCall('call')] }
    ])
    // This endpoint is not served by the compatible chat serializer, so its body is not asserted.
    expect(names).not.toContain('gemini-thought-signature-replay')
  })

  it('AC14 ignores signatures on text and reasoning without mutating the input', async () => {
    const prompt = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'text', providerOptions: source('r') },
          { type: 'reasoning', text: 'reasoning', providerOptions: source('r') },
          toolCall('call')
        ]
      }
    ]
    const original = structuredClone(prompt)
    const { body } = await registeredWire('gemini-4-argon', 'openai-chat-completions', prompt)
    expect(body.messages[0].tool_calls[0].extra_content.google.thought_signature).toBe(sentinel)
    expect(prompt).toEqual(original)
  })

  it('AC11 preserves each signature and its corresponding tool result', async () => {
    const { body } = await registeredWire('gemini-4-argon', 'openai-chat-completions', [
      { role: 'assistant', content: [toolCall('call_1', source('one')), toolCall('call_2', source('two'))] },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'call_1', toolName: 'lookup', output: { type: 'text', value: 'first' } },
          { type: 'tool-result', toolCallId: 'call_2', toolName: 'lookup', output: { type: 'text', value: 'second' } }
        ]
      }
    ])
    expect(
      body.messages[0].tool_calls.map((call: any) => [call.id, call.extra_content.google.thought_signature])
    ).toEqual([
      ['call_1', 'one'],
      ['call_2', 'two']
    ])
    expect(body.messages.slice(1).map((message: any) => [message.role, message.tool_call_id, message.content])).toEqual(
      [
        ['tool', 'call_1', 'first'],
        ['tool', 'call_2', 'second']
      ]
    )
  })
  it.each([false, true])(
    'AC7 projects the current namespace without losing extra fields (stream=%s)',
    async (stream) => {
      const calls = await wire(
        [
          {
            ...source('  real bytes  '),
            google: { thoughtSignature: sentinel },
            openaiCompatible: wireOption(sentinel)
          }
        ],
        stream
      )
      expect(calls[0].extra_content).toEqual({
        sibling: 'keep',
        google: { marker: 'keep', thought_signature: '  real bytes  ' }
      })
    }
  )
  it('AC4 canonical wins', async () => {
    const calls = await wire([
      { ...source('source'), google: { thoughtSignature: 'canonical' }, openaiCompatible: wireOption('wire') }
    ])
    expect(calls[0].extra_content.google.thought_signature).toBe('canonical')
  })
  it.each([undefined, sentinel, 42])('AC5/6 wire wins over non-real canonical %s', async (c) => {
    const calls = await wire([
      { ...source('source'), google: { thoughtSignature: c }, openaiCompatible: wireOption('wire') }
    ])
    expect(calls[0].extra_content).toEqual({ sibling: 'keep', google: { marker: 'keep', thought_signature: 'wire' } })
  })
  it.each([undefined, sentinel, '', '  ', null, 42, false, {}])(
    'AC3/9/10 invalid signatures fall back: %s',
    async (value) => {
      const calls = await wire([
        { ...source(value), google: { thoughtSignature: value }, openaiCompatible: wireOption(value) }
      ])
      expect(calls[0].extra_content.google.thought_signature).toBe(sentinel)
    }
  )
  it('AC8 ignores foreign namespaces', async () => {
    const calls = await wire([{ foreign: { thoughtSignature: 'foreign' } }])
    expect(calls[0].extra_content.google.thought_signature).toBe(sentinel)
  })
  it('AC11/12 keeps independent calls and requests', async () => {
    const calls = await wire([source('one'), source('two'), {}])
    expect(calls.map((call: any) => call.extra_content.google.thought_signature)).toEqual(['one', 'two', sentinel])
    expect(calls.map((call: any) => call.id)).toEqual(['call_0', 'call_1', 'call_2'])
    expect((await wire([{}]))[0].extra_content.google.thought_signature).toBe(sentinel)
  })
})
