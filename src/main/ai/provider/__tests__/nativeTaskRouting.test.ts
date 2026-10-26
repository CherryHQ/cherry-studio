import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import { createExecutor } from '@cherrystudio/ai-core'
import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import type { AppProviderSettingsMap } from '@main/ai/types'
import { userProviderTable } from '@main/data/db/schemas/userProvider'
import { modelService } from '@main/data/services/ModelService'
import { providerRegistryService } from '@main/data/services/ProviderRegistryService'
import { providerService } from '@main/data/services/ProviderService'

import { resolveRequestEndpoint } from '../endpoint'
import { BedrockExtension, VoyageExtension } from '../extensions'
import { resolveSdkConfig } from '../sdkConfig'

for (const extension of [BedrockExtension, VoyageExtension]) {
  if (!extensionRegistry.has(extension.config.name)) extensionRegistry.register(extension)
}
const dbh = setupTestDatabase()

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

it('keeps the Voyage reranker adapter from inherited defaults through response decoding', async () => {
  const providerId = 'voyageai'
  const modelId = 'rerank-2'
  dbh.db
    .insert(userProviderTable)
    .values({ providerId, presetProviderId: providerId, name: providerId, orderKey: 'a0' })
    .run()
  modelService.create([
    { dto: { providerId, modelId }, registryData: providerRegistryService.lookupModel(providerId, modelId) }
  ])
  const provider = providerService.getByProviderId(providerId)
  const model = modelService.getByKey(providerId, modelId)
  const { sdkConfig } = await resolveSdkConfig(
    provider,
    model,
    resolveRequestEndpoint(provider, model, 'rerank'),
    'fixture-key'
  )
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        object: 'list',
        data: [{ index: 1, relevance_score: 0.9 }],
        model: modelId,
        usage: { total_tokens: 4 }
      }),
      { headers: { 'content-type': 'application/json' } }
    )
  )
  const executor = await createExecutor<AppProviderSettingsMap>(sdkConfig.providerId, {
    ...sdkConfig.providerSettings,
    fetch
  })
  const result = await executor.rerank({
    model: sdkConfig.modelId,
    query: 'apple',
    documents: ['car', 'fruit'],
    topN: 1,
    maxRetries: 0
  })
  expect(result.ranking).toEqual([{ originalIndex: 1, score: 0.9, document: 'fruit' }])
  expect(String(fetch.mock.calls[0][0])).toBe('https://api.voyageai.com/v1/rerank')
})

it('runs Titan embedding through the Bedrock adapter with its SDK-derived host', async () => {
  const providerId = 'aws-bedrock'
  const modelId = 'amazon.titan-embed-text-v2:0'
  dbh.db
    .insert(userProviderTable)
    .values({ providerId, presetProviderId: providerId, name: providerId, orderKey: 'a0' })
    .run()
  modelService.create([
    {
      dto: { providerId, modelId, capabilities: ['embedding'] },
      registryData: providerRegistryService.lookupModel(providerId, modelId)
    }
  ])
  const provider = providerService.getByProviderId(providerId)
  const model = modelService.getByKey(providerId, modelId)
  const { sdkConfig } = await resolveSdkConfig(
    provider,
    model,
    resolveRequestEndpoint(provider, model, 'embedding'),
    'fixture-key'
  )
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        embedding: [0.2, 0.4],
        inputTextTokenCount: 2
      }),
      { headers: { 'content-type': 'application/json' } }
    )
  )
  const executor = await createExecutor<AppProviderSettingsMap>(sdkConfig.providerId, {
    ...sdkConfig.providerSettings,
    region: 'us-east-1',
    fetch
  })
  const result = await executor.embedMany({ model: sdkConfig.modelId, values: ['hello'], maxRetries: 0 })
  expect(result.embeddings).toEqual([[0.2, 0.4]])
  expect(new URL(String(fetch.mock.calls[0][0])).hostname).toBe('bedrock-runtime.us-east-1.amazonaws.com')
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ inputText: 'hello' })
})
