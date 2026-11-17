import { fileURLToPath } from 'node:url'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { isJSONObject, type LanguageModelV3CallOptions, type LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { assert, describe, expect, it } from 'vitest'

import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { mergePresetModel, resolveReasoningProfileFromRegistry } from '@data/services/ProviderRegistryService'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { computeLanguageCost, createAiUsagePricingSnapshot } from '@shared/utils/usagePricing'

import {
  encodeReasoningInvocation,
  normalizeRequestedSelection,
  resolveReasoningInvocation
} from '../../utils/reasoningSerializers'

const data = new URL('../../../../../packages/provider-registry/data/', import.meta.url)
const registry = new RegistryLoader({
  models: fileURLToPath(new URL('models.json', data)),
  providers: fileURLToPath(new URL('providers.json', data)),
  providerModels: fileURLToPath(new URL('provider-models.json', data))
})
const preset = registry.findModel('qwen3-8-27b')!
const offer = registry.findOverride('fortytwo', 'qwen3-8-27b')!
const provider = registry.findProvider('fortytwo')!
const reasoning = resolveReasoningProfileFromRegistry({
  endpointType: 'openai-chat-completions',
  format: provider.endpointConfigs?.['openai-chat-completions']?.reasoningFormat,
  contract: offer.reasoningContracts?.['openai-chat-completions']
})
const model = mergePresetModel(preset, offer, 'fortytwo', reasoning.wire, reasoning.support)
const prompt: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'Reply OK.' }] }]
const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

function sdk(fetch: typeof globalThis.fetch) {
  return createOpenAICompatible({
    name: 'fortytwo-connection',
    baseURL: 'https://api.fortytwo.network/v1',
    apiKey: 'synthetic-fortytwo-connection-key',
    fetch
  })(model.apiModelId!)
}

function success(field = 'reasoning') {
  return new Response(
    JSON.stringify({
      id: 'fixture',
      choices: [{ message: { role: 'assistant', content: 'OK', [field]: 'fixture reasoning' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }),
    { headers: { 'content-type': 'application/json' } }
  )
}

describe('Fortytwo resolved model and billing', () => {
  it('retains only the serving capabilities, limits and effort controls', () => {
    expect(model).toMatchObject({
      apiModelId: 'qwen/qwen3.8-27b',
      contextWindow: 262144,
      maxOutputTokens: 235929,
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      endpointTypes: ['openai-chat-completions']
    })
    expect(model.reasoning?.selectableEfforts).toEqual(efforts)
    expect(model.reasoning?.thinkingTokenLimits).toBeUndefined()
  })

  it('preserves free cache writes instead of the inherited canonical tariff', () => {
    const snapshot = createAiUsagePricingSnapshot(model.pricing)
    expect(model.pricing?.cacheWrite?.perMillionTokens).toBe(0)
    expect(snapshot).toHaveProperty('cacheWritePerMillionTokens', 0)
    expect(model.pricing?.inputTokenTiers).toEqual([])
    expect(preset.pricing?.cacheWrite?.perMillionTokens).toBe(0.625)
    assert(snapshot)
    expect(
      computeLanguageCost(
        { inputTokens: 1000000, outputTokens: 1000000, inputTokenDetails: { cacheReadTokens: 500000 } },
        snapshot
      )?.cost
    ).toBeCloseTo(2.805)
    expect(computeLanguageCost({ inputTokens: 1000000, outputTokens: 1000000 }, snapshot)?.cost).toBeCloseTo(2.975)
  })
})

describe('Fortytwo installed SDK request boundary', () => {
  it.each<ReasoningEffortOption>([...efforts, 'default', 'ultra', 'auto'])(
    'serialises %s without unsupported reasoning knobs',
    async (selection) => {
      let body: Record<string, unknown> = {}
      let headers = new Headers()
      let url = ''
      const languageModel = sdk(async (input, init) => {
        url = String(input)
        body = JSON.parse(String(init?.body))
        headers = new Headers(init?.headers)
        return success()
      })
      const normalized = normalizeRequestedSelection(selection, model)
      const invocation = resolveReasoningInvocation({ selection: normalized, model, profile: reasoning.wire })
      const options = encodeReasoningInvocation(invocation)
      assert(isJSONObject(options))
      const result = await languageModel.doGenerate({
        prompt,
        maxOutputTokens: 32,
        providerOptions: { 'fortytwo-connection': options }
      })
      expect(url).toBe('https://api.fortytwo.network/v1/chat/completions')
      expect(body.model).toBe('qwen/qwen3.8-27b')
      expect(body.reasoning_effort).toBe(
        ['default', 'auto'].includes(selection) ? undefined : selection === 'ultra' ? 'max' : selection
      )
      expect(body).not.toHaveProperty('thinking')
      expect(body).not.toHaveProperty('reasoning')
      expect(headers.get('authorization')).toBe('Bearer synthetic-fortytwo-connection-key')
      expect(result.content).toContainEqual({ type: 'text', text: 'OK' })
    }
  )

  it.each(['reasoning', 'reasoning_content'])('parses non-streaming %s separately from the answer', async (field) => {
    const result = await sdk(async () => success(field)).doGenerate({ prompt })
    expect(result.content).toContainEqual({ type: 'reasoning', text: 'fixture reasoning' })
    expect(result.content).toContainEqual({ type: 'text', text: 'OK' })
  })

  it.each(['reasoning', 'reasoning_content'])('parses streamed %s separately from text', async (field) => {
    const response = `data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { [field]: 'fixture reasoning' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
    const result = await sdk(
      async () => new Response(response, { headers: { 'content-type': 'text/event-stream' } })
    ).doStream({ prompt })
    const parts: LanguageModelV3StreamPart[] = []
    for await (const part of result.stream) parts.push(part)
    expect(parts).toContainEqual(expect.objectContaining({ type: 'reasoning-delta', delta: 'fixture reasoning' }))
    expect(parts).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'OK' }))
  })

  it('preserves a rejected key as a 401 instead of returning an answer', async () => {
    const languageModel = sdk(
      async () =>
        new Response(JSON.stringify({ error: { message: 'Invalid API key', type: 'authentication_error' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })
    )
    await expect(languageModel.doGenerate({ prompt })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('propagates a transport failure instead of fabricating a completion', async () => {
    const languageModel = sdk(async () => {
      throw new Error('fixture connection refused')
    })
    await expect(languageModel.doGenerate({ prompt })).rejects.toThrow('fixture connection refused')
  })
})
