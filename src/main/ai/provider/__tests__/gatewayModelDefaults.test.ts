import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { createExecutor } from '@cherrystudio/ai-core'
import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import type { AppProviderSettingsMap } from '@main/ai/types'
import { userProviderTable } from '@main/data/db/schemas/userProvider'
import { modelService } from '@main/data/services/ModelService'
import { providerRegistryService } from '@main/data/services/ProviderRegistryService'
import { providerService } from '@main/data/services/ProviderService'

import { buildCapabilityProviderOptions } from '../../utils/options'
import { resolveReasoningInvocation } from '../../utils/reasoningSerializers'
import { resolveEffectiveEndpoint } from '../endpoint'
import { AiHubMixExtension, DmxapiExtension } from '../extensions'
import { resolveSdkConfig } from '../sdkConfig'

for (const extension of [AiHubMixExtension, DmxapiExtension]) {
  if (!extensionRegistry.has(extension.config.name)) extensionRegistry.register(extension)
}

const dbh = setupTestDatabase()
const modelId = 'claude-sonnet-4-5'

beforeEach(() => {
  const getPath = vi.mocked(application.getPath).getMockImplementation()!
  vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
    key === 'feature.provider_registry.data'
      ? resolve('packages/provider-registry/data', filename ?? '')
      : key === 'app.root'
        ? resolve(filename ?? '')
        : getPath(key, filename)
  )
  providerRegistryService.clearCache()
})

afterEach(() => {
  vi.restoreAllMocks()
  providerRegistryService.clearCache()
})

for (const presetProviderId of ['aihubmix', 'dmxapi']) {
  describe(presetProviderId, () => {
    it.each([false, true])(
      'preserves native reasoning from model creation to SDK request (clone: %s)',
      async (clone) => {
        const providerId = clone ? `custom-${presetProviderId}` : presetProviderId
        dbh.db
          .insert(userProviderTable)
          .values({ providerId, presetProviderId, name: providerId, orderKey: 'a0' })
          .run()
        const [preview] = providerRegistryService.resolveModels(providerId, [modelId])
        modelService.create([
          { dto: { providerId, modelId }, registryData: providerRegistryService.lookupModel(providerId, modelId) }
        ])
        const model = modelService.getByKey(providerId, modelId)
        const provider = providerService.getByProviderId(providerId)
        const endpoint = resolveEffectiveEndpoint(provider, model)
        const { sdkConfig } = await resolveSdkConfig(provider, model, endpoint, 'fixture-only')
        const profile = providerRegistryService.resolveReasoningProfile(provider, model, endpoint.endpointType)
        const reasoning = resolveReasoningInvocation({
          model,
          profile: profile.wire,
          selection: 'high',
          maxTokens: 32000
        })
        const providerOptions = buildCapabilityProviderOptions(
          model,
          provider,
          { enableReasoning: true, enableWebSearch: false, enableGenerateImage: false },
          {
            aiSdkProviderId: sdkConfig.providerId,
            runtimeProviderId: sdkConfig.providerId,
            providerOptionsKey: sdkConfig.providerOptionsKey,
            endpointType: endpoint.endpointType,
            reasoning
          }
        )
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
          new Response(JSON.stringify({ error: { message: 'captured' } }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          })
        )
        const executor = await createExecutor<AppProviderSettingsMap>(sdkConfig.providerId, {
          ...sdkConfig.providerSettings,
          fetch
        })
        const languageModel = await executor.languageModel(sdkConfig.modelId)
        await expect(
          languageModel.doGenerate({
            prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
            maxOutputTokens: 32000,
            providerOptions
          })
        ).rejects.toMatchObject({ statusCode: 400 })
        const body = JSON.parse(String(fetch.mock.calls[0][1]?.body))
        expect(body.thinking).toMatchObject({ type: 'enabled', budget_tokens: expect.any(Number) })
        expect(body.thinking.budget_tokens).toBeGreaterThan(0)
        expect(body.reasoning_effort).toBeUndefined()
        expect(preview.endpointTypes).toEqual(['anthropic-messages'])
        expect(model.endpointTypes).toEqual(['anthropic-messages'])
        expect(sdkConfig.providerOptionsKey).toBe('anthropic')
      }
    )

    it.each([
      ['openai-chat-completions', '/chat/completions', 'claude-sonnet-4-5'],
      ['openai-chat-completions', '/chat/completions', 'gpt-5'],
      ['openai-responses', '/responses', 'claude-sonnet-4-5'],
      ['openai-responses', '/responses', 'gpt-5'],
      ['google-generate-content', '/models/claude-sonnet-4-5:generateContent', 'claude-sonnet-4-5']
    ] as const)('executes the explicit %s endpoint at %s for %s', async (endpointType, path, modelId) => {
      dbh.db
        .insert(userProviderTable)
        .values({
          providerId: presetProviderId,
          presetProviderId,
          name: presetProviderId,
          orderKey: 'a0',
          endpointConfigs: {
            [endpointType]: { baseUrl: 'https://selected.example/v1', adapterFamily: presetProviderId }
          }
        })
        .run()
      modelService.create([
        {
          dto: { providerId: presetProviderId, modelId, endpointTypes: [endpointType] },
          registryData: providerRegistryService.lookupModel(presetProviderId, modelId)
        }
      ])
      const model = modelService.getByKey(presetProviderId, modelId)
      const provider = providerService.getByProviderId(presetProviderId)
      const { sdkConfig } = await resolveSdkConfig(
        provider,
        model,
        resolveEffectiveEndpoint(provider, model),
        'fixture-only'
      )
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}', { status: 400 }))
      const executor = await createExecutor<AppProviderSettingsMap>(sdkConfig.providerId, {
        ...sdkConfig.providerSettings,
        fetch
      })
      const languageModel = await executor.languageModel(sdkConfig.modelId)
      await expect(
        languageModel.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          providerOptions: {
            [sdkConfig.providerOptionsKey]:
              endpointType === 'google-generate-content'
                ? { thinkingConfig: { thinkingBudget: 1024, includeThoughts: true } }
                : { reasoningEffort: 'high' }
          }
        })
      ).rejects.toMatchObject({ statusCode: 400 })
      const url = new URL(String(fetch.mock.calls[0][0]))
      expect(url.host).toBe('selected.example')
      expect(url.pathname.endsWith(path)).toBe(true)
      const body = JSON.parse(String(fetch.mock.calls[0][1]?.body))
      expect(body).toHaveProperty(
        endpointType === 'openai-responses'
          ? 'input'
          : endpointType === 'google-generate-content'
            ? 'contents'
            : 'messages'
      )
      if (endpointType === 'openai-chat-completions') expect(body.reasoning_effort).toBe('high')
      if (endpointType === 'openai-responses' && modelId === 'gpt-5') expect(body.reasoning.effort).toBe('high')
      if (endpointType === 'google-generate-content')
        expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(1024)
      expect(body.anthropic_version).toBeUndefined()
    })

    it('preserves explicit endpoint choices across loading and default reset', () => {
      dbh.db
        .insert(userProviderTable)
        .values({ providerId: presetProviderId, presetProviderId, name: presetProviderId, orderKey: 'a0' })
        .run()
      modelService.create([
        {
          dto: { providerId: presetProviderId, modelId, endpointTypes: ['openai-chat-completions'] },
          registryData: providerRegistryService.lookupModel(presetProviderId, modelId)
        }
      ])
      const model = modelService.getByKey(presetProviderId, modelId)
      expect(resolveEffectiveEndpoint(providerService.getByProviderId(presetProviderId), model).endpointType).toBe(
        'openai-chat-completions'
      )
      const reset = modelService.update(presetProviderId, modelId, { resetFields: ['endpointTypes'] })
      expect(reset.endpointTypes).toEqual(['anthropic-messages'])
    })
  })
}
