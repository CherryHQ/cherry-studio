import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { createCustomModel, mergePresetModel, providerRegistryService } from '@data/services/ProviderRegistryService'
import type { EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import {
  buildCapabilityProviderOptions,
  buildResolvedReasoningProviderOptions,
  mergeCustomProviderParameters
} from '../options'
import { normalizeRequestedSelection, resolveReasoningInvocation } from '../reasoningSerializers'

const dataPath = `${process.cwd()}/packages/provider-registry/data`
beforeAll(() => {
  vi.mocked(application.getPath).mockImplementation((key, file) =>
    key === 'feature.provider_registry.data' ? `${dataPath}/${file}` : `/nonexistent/${file ?? ''}`
  )
})

function setup(endpointType: EndpointType, unlisted = false) {
  const provider = {
    id: 'custom-vllm',
    presetProviderId: null,
    defaultChatEndpoint: endpointType
  } as unknown as Provider
  const id = unlisted ? 'Qwen3.8-27B-unlisted-variant' : 'Qwen3.8-27B'
  const lookup = providerRegistryService.resolveModel(provider, id)
  const profile = lookup.reasoningProfile.wire
  const model = lookup.presetModel
    ? {
        ...mergePresetModel(
          lookup.presetModel,
          lookup.registryOverride,
          provider.id,
          profile,
          lookup.reasoningProfile.support
        ),
        id: `${provider.id}::${id}` as const,
        apiModelId: id,
        endpointTypes: [endpointType]
      }
    : createCustomModel(provider.id, id, profile)
  return { provider, lookup, profile, model, endpointType, id }
}

async function request(input: ReturnType<typeof setup>, selection: 'none' | 'default' | 'high', custom = false) {
  const { provider, profile, model, endpointType, id } = input
  const reasoning = resolveReasoningInvocation({
    selection: normalizeRequestedSelection(selection, model),
    model,
    profile
  })
  const context = {
    aiSdkProviderId: 'openai-compatible',
    runtimeProviderId: 'openai-compatible',
    providerOptionsKey: provider.id,
    endpointType,
    reasoning
  }
  let options = buildCapabilityProviderOptions(
    model,
    provider,
    { enableReasoning: true, enableWebSearch: false, enableGenerateImage: false },
    context
  )
  if (custom)
    options = mergeCustomProviderParameters(options, { reasoning_effort: 'none' }, provider.id, 'openai-compatible')
  const resolved = buildResolvedReasoningProviderOptions(context)
  let body: Record<string, unknown> = {}
  const sdk = createOpenAICompatible({
    name: provider.id,
    baseURL: 'http://localhost/v1',
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      const invalid =
        body.reasoning_effort !== undefined && !['low', 'medium', 'xhigh'].includes(String(body.reasoning_effort))
      return new Response(
        JSON.stringify(
          invalid
            ? { error: { message: `Unexpected reasoning effort ${body.reasoning_effort}`, type: 'BadRequestError' } }
            : {
                id: 'test',
                object: 'chat.completion',
                created: 1,
                model: model.apiModelId,
                choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
              }
        ),
        { status: invalid ? 400 : 200, headers: { 'content-type': 'application/json' } }
      )
    }
  })
  let succeeded = true
  try {
    await sdk
      .chatModel(id)
      .doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], providerOptions: options })
  } catch {
    succeeded = false
  }
  return { options, resolved, body, succeeded }
}

describe('compatible endpoint reasoning fallback', () => {
  it('projects the real catalog model without an override', () => {
    const { lookup, model } = setup('openai-chat-completions')
    expect(lookup.presetModel?.id).toBe('qwen3-8-27b')
    expect(lookup.registryOverride).toBeNull()
    expect(model.reasoning?.selectableEfforts).toEqual(['low', 'medium', 'xhigh'])
  })
  it.each(['openai-chat-completions', 'openai-responses', 'openai-text-completions'] as const)(
    '%s omits Off through both builders and the SDK',
    async (endpoint) => {
      const result = await request(setup(endpoint), 'none')
      expect(result.options['custom-vllm']).not.toHaveProperty('reasoningEffort')
      expect(result.resolved['custom-vllm'] ?? {}).not.toHaveProperty('reasoningEffort')
      expect(result.body).not.toHaveProperty('reasoning_effort')
      expect(result.body.model).toBe('Qwen3.8-27B')
      expect(result.succeeded).toBe(true)
    }
  )
  it('omits Off for an unlisted toggle-only model', async () => {
    const input = setup('openai-chat-completions', true)
    expect(input.model.reasoning?.selectableEfforts).toEqual(['auto'])
    const result = await request(input, 'none')
    expect(result.body).not.toHaveProperty('reasoning_effort')
    expect(result.succeeded).toBe(true)
  })
  it('omits the default selection and maps high to xhigh', async () => {
    const input = setup('openai-chat-completions')
    const normal = await request(input, 'default')
    expect(normal.body).not.toHaveProperty('reasoning_effort')
    expect(normal.succeeded).toBe(true)
    const high = await request(input, 'high')
    expect(high.body.reasoning_effort).toBe('xhigh')
    expect(high.succeeded).toBe(true)
  })
  it('preserves explicit custom parameters', async () => {
    const result = await request(setup('openai-chat-completions'), 'none', true)
    expect(result.body.reasoning_effort).toBe('none')
    expect(result.succeeded).toBe(false)
  })
})
