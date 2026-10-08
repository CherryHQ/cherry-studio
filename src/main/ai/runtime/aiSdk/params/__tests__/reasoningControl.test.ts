import { createAnthropic } from '@ai-sdk/anthropic'
import { createAzure } from '@ai-sdk/azure'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import { REASONING_FORMAT_PROFILES } from '@cherrystudio/provider-registry'
import { makeModel } from '@main/ai/__tests__/fixtures'
import { resolveProviderOptionsKey } from '@main/ai/provider/endpoint'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'

import { createRetryableWrap } from '../../retry/createRetryableWrap'
import { createReasoningMiddleware, type ReasoningControl } from '../reasoningControl'

const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Test' }] }]

function control(overrides: Partial<ReasoningControl> = {}): ReasoningControl {
  return {
    model: makeModel({
      reasoning: { selectableEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] }
    }),
    profile: REASONING_FORMAT_PROFILES['openai-chat'].wire,
    providerId: 'openai-chat',
    providerOptionsKey: 'openai',
    endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    enabled: true,
    selection: 'high',
    ...overrides
  }
}

async function capture(
  createModel: (fetch: typeof globalThis.fetch) => LanguageModelV4,
  policy: ReasoningControl,
  options: Partial<LanguageModelV4CallOptions> = {},
  observe?: (params: LanguageModelV4CallOptions) => void
) {
  let body: any
  const model = wrapLanguageModel({
    model: createModel(async (_url, init) => {
      body = JSON.parse(init!.body as string)
      throw new Error('Captured request')
    }),
    middleware: [
      createReasoningMiddleware(policy),
      {
        specificationVersion: 'v4',
        transformParams: async ({ params }) => {
          observe?.(params)
          return params
        }
      }
    ]
  })
  await expect(model.doGenerate({ prompt, ...options })).rejects.toThrow('Captured request')
  return body
}

describe('registry reasoning through real SDK providers', () => {
  it.each([undefined, 4000])('delivers a Vertex Anthropic budget with canonical override %s', async (budgetTokens) => {
    const body = await capture(
      (fetch) =>
        createVertexAnthropic({ baseURL: 'https://test.invalid', generateAuthToken: async () => 'test', fetch })(
          'claude-sonnet-4-5'
        ),
      control({
        providerId: 'google-vertex-anthropic',
        providerOptionsKey: resolveProviderOptionsKey('google-vertex-anthropic'),
        endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        profile: REASONING_FORMAT_PROFILES.anthropic.budgetWire!,
        model: makeModel({ reasoning: { selectableEfforts: ['high'], thinkingTokenLimits: { min: 1024, max: 10000 } } })
      }),
      {
        maxOutputTokens: 10000,
        ...(budgetTokens !== undefined && {
          providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens } } }
        })
      }
    )
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: budgetTokens ?? 8204 })
    expect(body.max_tokens).toBe(10000)
  })

  it('respects the Azure native namespace above a per-call level and does not invent a summary', async () => {
    const body = await capture(
      (fetch) => createAzure({ apiKey: 'test', baseURL: 'https://test.invalid', fetch }).responses('gpt-5'),
      control({ providerId: 'azure-responses', endpointType: ENDPOINT_TYPE.OPENAI_RESPONSES }),
      { reasoning: 'high', providerOptions: { azure: { reasoningEffort: 'low' } } },
      (params) => expect(params.reasoning).toBeUndefined()
    )
    expect(body.reasoning).toEqual({ effort: 'low' })
  })

  it('re-resolves a fallback budget without inheriting the primary generated effort', async () => {
    const primaryBodies: any[] = []
    let fallbackBody: any
    const primary = wrapLanguageModel({
      model: createOpenAI({
        apiKey: 'test',
        fetch: async (_url, init) => {
          primaryBodies.push(JSON.parse(String(init?.body)))
          return Response.json({ error: { message: 'unavailable' } }, { status: 401 })
        }
      }).chat('gpt-5'),
      middleware: createReasoningMiddleware(control())
    })
    const fallback = wrapLanguageModel({
      model: createAnthropic({
        apiKey: 'test',
        fetch: async (_url, init) => {
          fallbackBody = JSON.parse(String(init?.body))
          throw new Error('Captured fallback')
        }
      })('claude-sonnet-4-5'),
      middleware: createReasoningMiddleware(
        control({
          selection: 'medium',
          providerId: 'anthropic',
          providerOptionsKey: 'anthropic',
          endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
          profile: REASONING_FORMAT_PROFILES.anthropic.budgetWire!,
          model: makeModel({
            reasoning: { selectableEfforts: ['medium', 'high'], thinkingTokenLimits: { min: 1024, max: 64000 } }
          })
        })
      )
    })
    const wrap = createRetryableWrap({
      fallbacks: [async () => ({ model: fallback, options: { maxOutputTokens: 64000, providerOptions: {} } })],
      retryPolicy: { enabled: true, maxAttempts: 1, backoffEnabled: false, fallbackModelIds: [] }
    })!
    await expect(wrap(primary).doGenerate({ prompt, maxOutputTokens: 10000 })).rejects.toThrow('Captured fallback')
    expect(primaryBodies).toHaveLength(1)
    expect(primaryBodies[0].reasoning_effort).toBe('high')
    expect(fallbackBody.thinking).toEqual({ type: 'enabled', budget_tokens: 32512 })
    expect(fallbackBody.max_tokens).toBe(64000)
    expect(fallbackBody).not.toHaveProperty('output_config')
  })

  it.each(['chat', 'responses', 'compatible', 'anthropic', 'google'] as const)(
    'delivers the registry effort natively to %s and strips SDK reasoning',
    async (adapter) => {
      const policy = control(
        adapter === 'anthropic'
          ? {
              providerId: 'anthropic',
              providerOptionsKey: 'anthropic',
              profile: REASONING_FORMAT_PROFILES.anthropic.wire
            }
          : adapter === 'google'
            ? {
                providerId: 'google',
                providerOptionsKey: 'google',
                profile: REASONING_FORMAT_PROFILES.gemini.wire,
                model: makeModel({ presetModelId: 'gemini-3-pro-preview', reasoning: { selectableEfforts: ['high'] } })
              }
            : {
                providerId:
                  adapter === 'responses' ? 'openai' : adapter === 'compatible' ? 'openai-compatible' : 'openai-chat'
              }
      )
      const create = (fetch: typeof globalThis.fetch) => {
        if (adapter === 'anthropic') return createAnthropic({ apiKey: 'test', fetch })('claude-sonnet-5-5')
        if (adapter === 'google') return createGoogleGenerativeAI({ apiKey: 'test', fetch })('gemini-3-pro-preview')
        if (adapter === 'compatible')
          return createOpenAICompatible({ name: 'openai', baseURL: 'https://test.invalid', fetch }).chatModel('model')
        const openai = createOpenAI({ apiKey: 'test', fetch })
        return adapter === 'responses' ? openai.responses('gpt-5') : openai.chat('gpt-5')
      }
      const body = await capture(create, policy, { reasoning: 'high' }, (params) => {
        expect(params.reasoning).toBeUndefined()
      })
      if (adapter === 'anthropic') expect(body.output_config.effort).toBe('high')
      else if (adapter === 'google') expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('high')
      else if (adapter === 'responses') expect(body.reasoning.effort).toBe('high')
      else expect(body.reasoning_effort).toBe('high')
      const streamModel = wrapLanguageModel({
        model: create(async () => new Response('', { headers: { 'Content-Type': 'text/event-stream' } })),
        middleware: createReasoningMiddleware(policy)
      })
      const { stream } = await streamModel.doStream({ prompt })
      const reader = stream.getReader()
      expect((await reader.read()).value).toEqual({ type: 'stream-start', warnings: [] })
      await reader.cancel()
    }
  )

  it('uses a per-call SDK choice without leaving the previous generated effort behind', async () => {
    const create = (fetch: typeof globalThis.fetch) => createOpenAI({ apiKey: 'test', fetch }).chat('gpt-5')
    expect((await capture(create, control())).reasoning_effort).toBe('high')
    expect((await capture(create, control(), { reasoning: 'low' })).reasoning_effort).toBe('low')
    expect((await capture(create, control(), { reasoning: 'provider-default' })).reasoning_effort).toBeUndefined()
    expect((await capture(create, control())).reasoning_effort).toBe('high')
  })

  it('keeps explicit native effort above generated selection', async () => {
    const body = await capture((fetch) => createOpenAI({ apiKey: 'test', fetch }).chat('gpt-5'), control(), {
      reasoning: 'high',
      providerOptions: { openai: { reasoningEffort: 'low' } }
    })
    expect(body.reasoning_effort).toBe('low')
  })

  it('retains a compatible endpoint toggle instead of sending a generic effort field', async () => {
    const body = await capture(
      (fetch) => createOpenAICompatible({ name: 'custom', baseURL: 'https://test.invalid', fetch }).chatModel('qwen'),
      control({
        providerId: 'openai-compatible',
        providerOptionsKey: 'custom',
        selection: 'none',
        profile: { off: { operations: [{ target: 'enable_thinking', value: { source: 'literal', value: false } }] } }
      })
    )
    expect(body.enable_thinking).toBe(false)
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('keeps the total output cap and exact descriptor budget on an older Claude', async () => {
    const body = await capture(
      (fetch) => createAnthropic({ apiKey: 'test', fetch })('claude-sonnet-4-5'),
      control({
        providerId: 'anthropic',
        providerOptionsKey: 'anthropic',
        endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        profile: REASONING_FORMAT_PROFILES.anthropic.budgetWire!,
        model: makeModel({
          reasoning: { selectableEfforts: ['low', 'medium', 'high'], thinkingTokenLimits: { min: 1024, max: 64000 } }
        }),
        selection: 'medium'
      }),
      { maxOutputTokens: 64000 }
    )
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 32512 })
    expect(body.max_tokens).toBe(64000)
  })

  it('uses an explicit disabled mode for sampling and removes an obsolete generated budget', async () => {
    const body = await capture(
      (fetch) => createAnthropic({ apiKey: 'test', fetch })('claude-sonnet-4-5'),
      control({
        providerId: 'anthropic',
        providerOptionsKey: 'anthropic',
        endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        profile: REASONING_FORMAT_PROFILES.anthropic.budgetWire!,
        model: makeModel({
          id: 'anthropic::claude-sonnet-4-5',
          apiModelId: 'claude-sonnet-4-5',
          capabilities: [MODEL_CAPABILITY.REASONING],
          reasoning: { selectableEfforts: ['high'] }
        })
      }),
      { temperature: 0.4, maxOutputTokens: 10000, providerOptions: { anthropic: { thinking: { type: 'disabled' } } } }
    )
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.temperature).toBe(0.4)
    expect(body.max_tokens).toBe(10000)
  })

  it('keeps sampling when an explicit compatible effort disables a Claude model', async () => {
    const body = await capture(
      (fetch) =>
        createOpenAICompatible({ name: 'custom', baseURL: 'https://test.invalid', fetch }).chatModel(
          'claude-sonnet-4-5'
        ),
      control({
        providerId: 'openai-compatible',
        providerOptionsKey: 'custom',
        model: makeModel({
          id: 'custom::claude-sonnet-4-5',
          apiModelId: 'claude-sonnet-4-5',
          capabilities: [MODEL_CAPABILITY.REASONING],
          reasoning: { selectableEfforts: ['none', 'high'] }
        })
      }),
      { temperature: 0.4, providerOptions: { custom: { reasoningEffort: 'none' } } }
    )
    expect(body.reasoning_effort).toBe('none')
    expect(body.temperature).toBe(0.4)
  })

  it.each([
    ['auto', -1],
    ['none', 0]
  ] as const)('retains Gemini budget sentinel %s', async (selection, budget) => {
    const body = await capture(
      (fetch) => createGoogleGenerativeAI({ apiKey: 'test', fetch })('gemini-2.5-flash'),
      control({
        providerId: 'google',
        providerOptionsKey: 'google',
        selection,
        model: makeModel({ reasoning: { selectableEfforts: ['none', 'auto'] } }),
        profile: REASONING_FORMAT_PROFILES.gemini.budgetWire!
      }),
      {},
      (params) => expect(params.reasoning).toBeUndefined()
    )
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(budget)
    expect(body.generationConfig.thinkingConfig).not.toHaveProperty('thinkingLevel')
  })

  it('keeps Google thought visibility alongside the generated level', async () => {
    const body = await capture(
      (fetch) => createGoogleGenerativeAI({ apiKey: 'test', fetch })('gemini-3-pro-preview'),
      control({
        providerId: 'google',
        providerOptionsKey: 'google',
        endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        profile: REASONING_FORMAT_PROFILES.gemini.wire
      }),
      { providerOptions: { google: { thinkingConfig: { includeThoughts: false } } } }
    )
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'high', includeThoughts: false })
  })
})
