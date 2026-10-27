import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'
import * as z from 'zod'

import type { CreateModelDto } from '../../../src/shared/data/api/schemas/models'
import type { CreateProviderDto } from '../../../src/shared/data/api/schemas/providers'
import { createUniqueModelId } from '../../../src/shared/data/types/model'

const providerConfigSchema = z.object({
  baseUrl: z.string().trim().url(),
  apiKey: z.string().trim().min(1),
  model: z.string().trim().min(1)
})
const profileConfigSchema = providerConfigSchema.extend({
  anthropicBaseUrl: z.string().trim().url().optional(),
  embedding: providerConfigSchema.optional()
})
export type ProfileConfig = z.infer<typeof profileConfigSchema>

export function readProfileConfig(env: NodeJS.ProcessEnv = process.env): ProfileConfig {
  const embedding = {
    baseUrl: env.CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL,
    apiKey: env.CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_API_KEY,
    model: env.CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL
  }
  return profileConfigSchema.parse({
    baseUrl: env.CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL,
    apiKey: env.CHERRY_TEST_CUSTOM_PROVIDER_API_KEY,
    model: env.CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL,
    anthropicBaseUrl: env.CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL || undefined,
    embedding: Object.values(embedding).some((value) => value?.trim()) ? embedding : undefined
  })
}

export async function prepareAuthenticatedProfile(page: Page, config: ProfileConfig): Promise<void> {
  const providerId = `qa-chat-${randomUUID()}`
  const providers: Array<{ provider: CreateProviderDto; model: CreateModelDto }> = [
    {
      provider: {
        providerId,
        name: 'Cherry QA Provider',
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: {
          'openai-chat-completions': { baseUrl: config.baseUrl },
          ...(config.anthropicBaseUrl ? { 'anthropic-messages': { baseUrl: config.anthropicBaseUrl } } : {})
        },
        apiKeys: [{ id: randomUUID(), key: config.apiKey, isEnabled: true }]
      },
      model: { providerId, modelId: config.model, endpointTypes: ['openai-chat-completions'] }
    }
  ]
  if (config.embedding) {
    const embeddingId = `qa-embedding-${randomUUID()}`
    providers.push({
      provider: {
        providerId: embeddingId,
        name: 'Cherry QA Embedding',
        endpointConfigs: { 'openai-embeddings': { baseUrl: config.embedding.baseUrl } },
        apiKeys: [{ id: randomUUID(), key: config.embedding.apiKey, isEnabled: true }]
      },
      model: {
        providerId: embeddingId,
        modelId: config.embedding.model,
        endpointTypes: ['openai-embeddings'],
        capabilities: ['embedding']
      }
    })
  }
  await page.evaluate(
    async ({ providers, chatModelId }) => {
      for (const { provider, model } of providers) {
        const created = await window.api.dataApi.request({
          id: `${provider.providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: provider
        })
        if (created.status !== 201) throw new Error(`Provider preparation failed (${created.status})`)
        const enabled = await window.api.dataApi.request({
          id: `${provider.providerId}-enable`,
          method: 'PATCH',
          path: `/providers/${provider.providerId}`,
          body: { isEnabled: true }
        })
        if (enabled.status !== 200) throw new Error(`Provider activation failed (${enabled.status})`)
        const models = await window.api.dataApi.request({
          id: `${provider.providerId}-models`,
          method: 'POST',
          path: '/models',
          body: [model]
        })
        if (models.status !== 201) throw new Error(`Model preparation failed (${models.status})`)
      }
      await window.api.preference.setMultiple({
        'chat.default_model_id': chatModelId,
        'feature.translate.model_id': chatModelId,
        'app.onboarding.provider_setup.status': 'completed',
        'app.privacy.data_collection.enabled': false
      })
    },
    { providers, chatModelId: createUniqueModelId(providerId, config.model) }
  )
}
