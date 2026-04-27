import { createUniqueModelId, ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { defaultAppHeaders } from '@shared/utils'
import * as z from 'zod'

const OpenAIModelsResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      id: z.string(),
      owned_by: z.string().optional()
    })
  )
})

const NewApiModelsResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      id: z.string(),
      owned_by: z.string().optional(),
      supported_endpoint_types: z
        .array(z.string())
        .nullable()
        .optional()
        .transform((value) => value ?? undefined)
    })
  )
})

const OllamaTagsResponseSchema = z.object({
  models: z.array(
    z.looseObject({
      name: z.string()
    })
  )
})

const GeminiModelsResponseSchema = z.object({
  models: z.array(
    z.looseObject({
      name: z.string(),
      displayName: z.string().optional(),
      description: z.string().optional()
    })
  )
})

const GitHubModelsResponseSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    publisher: z.string().optional()
  })
)

const TogetherModelsResponseSchema = z.array(
  z.looseObject({
    id: z.string(),
    display_name: z.string().optional(),
    organization: z.string().optional(),
    description: z.string().optional()
  })
)

const OVMSConfigResponseSchema = z.record(
  z.string(),
  z.object({
    model_version_status: z
      .array(
        z.looseObject({
          state: z.string()
        })
      )
      .optional()
  })
)

const AIHubMixModelsResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      model_id: z.string(),
      model_name: z.string().optional(),
      desc: z.string().optional()
    })
  )
})

type RemoteModelSeed = {
  modelId: string
  name?: string
  description?: string
  group?: string
  ownedBy?: string
  endpointTypes?: EndpointType[]
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/** OpenAI-compatible providers expose GET {base}/v1/models; base in settings may omit the /v1 segment. */
function openAiCompatibleListModelsUrl(baseUrl: string): string {
  const root = withoutTrailingSlash(baseUrl)
  if (!root) {
    return ''
  }
  if (/\/v1(?:beta)?$/u.test(root)) {
    return `${root}/models`
  }
  return `${root}/v1/models`
}

function providerBaseUrl(provider: Provider): string {
  const endpoint = provider.defaultChatEndpoint ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  return withoutTrailingSlash(provider.endpointConfigs?.[endpoint]?.baseUrl ?? '')
}

function providerHeaders(provider: Provider, apiKey: string): Record<string, string> {
  return {
    ...defaultAppHeaders(),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}`, 'X-Api-Key': apiKey } : {}),
    ...(provider.settings.extraHeaders ?? {})
  }
}

async function fetchJson<T>(url: string, headers: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`Failed to fetch provider models: ${response.status} ${response.statusText}`)
  }

  const json = await response.json()
  return schema.parse(json)
}

function dedupeSeeds(items: RemoteModelSeed[]): RemoteModelSeed[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const modelId = item.modelId.trim()
    if (!modelId || seen.has(modelId)) {
      return false
    }
    seen.add(modelId)
    return true
  })
}

function toBaseModel(providerId: string, item: RemoteModelSeed): Model {
  return {
    id: createUniqueModelId(providerId, item.modelId),
    providerId,
    apiModelId: item.modelId,
    name: item.name ?? item.modelId,
    description: item.description,
    group: item.group,
    ownedBy: item.ownedBy,
    endpointTypes: item.endpointTypes,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
}

function isUnsupportedProvider(provider: Provider): boolean {
  return (
    provider.id === 'gateway' ||
    provider.id === 'anthropic' ||
    provider.authType === 'iam-aws' ||
    provider.authType === 'iam-gcp' ||
    provider.defaultChatEndpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
  )
}

export async function fetchRemoteProviderModels(provider: Provider, apiKey: string): Promise<Model[]> {
  if (isUnsupportedProvider(provider)) {
    return []
  }

  const headers = providerHeaders(provider, apiKey)
  const baseUrl = providerBaseUrl(provider)
  let seeds: RemoteModelSeed[] = []

  if (provider.id === 'ollama') {
    const response = await fetchJson(
      `${baseUrl.replace(/\/v1$/u, '').replace(/\/api$/u, '')}/api/tags`,
      headers,
      OllamaTagsResponseSchema
    )
    seeds = response.models.map((model) => ({
      modelId: model.name,
      name: model.name,
      ownedBy: 'ollama'
    }))
  } else if (provider.id === 'gemini') {
    const geminiBaseUrl = baseUrl.replace(/\/v1beta$/u, '').replace(/\/v1$/u, '')
    const response = await fetchJson(
      `${geminiBaseUrl}/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { ...defaultAppHeaders(), ...(provider.settings.extraHeaders ?? {}) },
      GeminiModelsResponseSchema
    )
    seeds = response.models.map((model) => {
      const modelId = model.name.startsWith('models/') ? model.name.slice('models/'.length) : model.name
      return {
        modelId,
        name: model.displayName ?? modelId,
        description: model.description
      }
    })
  } else if (provider.id === 'github') {
    const [catalogResponse, v1Response] = await Promise.all([
      fetchJson('https://models.github.ai/catalog/models', headers, GitHubModelsResponseSchema),
      fetchJson('https://models.github.ai/v1/models', headers, OpenAIModelsResponseSchema).catch(() => ({ data: [] }))
    ])

    seeds = [
      ...catalogResponse.map((model) => ({
        modelId: model.id,
        name: model.name ?? model.id,
        description: model.summary ?? model.description,
        ownedBy: model.publisher
      })),
      ...v1Response.data.map((model) => ({
        modelId: model.id,
        ownedBy: model.owned_by
      }))
    ]
  } else if (provider.id === 'ovms') {
    const response = await fetchJson(`${baseUrl.replace(/\/v1$/u, '')}/config`, headers, OVMSConfigResponseSchema)
    seeds = Object.entries(response)
      .filter(([, info]) => info.model_version_status?.some((version) => version.state === 'AVAILABLE'))
      .map(([modelId]) => ({
        modelId,
        name: modelId,
        ownedBy: 'ovms'
      }))
  } else if (provider.id === 'together') {
    const response = await fetchJson(`${baseUrl}/models`, headers, TogetherModelsResponseSchema)
    seeds = response.map((model) => ({
      modelId: model.id,
      name: model.display_name ?? model.id,
      description: model.description,
      ownedBy: model.organization
    }))
  } else if (provider.id === 'new-api' || provider.id === 'cherryin') {
    const response = await fetchJson(`${baseUrl}/models`, headers, NewApiModelsResponseSchema)
    seeds = response.data.map((model) => ({
      modelId: model.id,
      ownedBy: model.owned_by,
      endpointTypes: model.supported_endpoint_types as EndpointType[] | undefined
    }))
  } else if (provider.id === 'openrouter') {
    const [chatModels, embeddingModels] = await Promise.all([
      fetchJson('https://openrouter.ai/api/v1/models', headers, OpenAIModelsResponseSchema),
      fetchJson('https://openrouter.ai/api/v1/embeddings/models', headers, OpenAIModelsResponseSchema).catch(() => ({
        data: []
      }))
    ])
    seeds = [...chatModels.data, ...embeddingModels.data].map((model) => ({
      modelId: model.id,
      ownedBy: model.owned_by
    }))
  } else if (provider.id === 'ppio') {
    const [chatModels, embeddingModels, rerankModels] = await Promise.all([
      fetchJson(`${baseUrl}/models`, headers, OpenAIModelsResponseSchema),
      fetchJson(`${baseUrl}/models?model_type=embedding`, headers, OpenAIModelsResponseSchema).catch(() => ({
        data: []
      })),
      fetchJson(`${baseUrl}/models?model_type=reranker`, headers, OpenAIModelsResponseSchema).catch(() => ({
        data: []
      }))
    ])
    seeds = [...chatModels.data, ...embeddingModels.data, ...rerankModels.data].map((model) => ({
      modelId: model.id,
      ownedBy: model.owned_by
    }))
  } else if (provider.id === 'aihubmix') {
    const response = await fetchJson('https://aihubmix.com/api/v1/models', headers, AIHubMixModelsResponseSchema)
    seeds = response.data.map((model) => ({
      modelId: model.model_id,
      name: model.model_name ?? model.model_id,
      description: model.desc
    }))
  } else {
    const listUrl = openAiCompatibleListModelsUrl(baseUrl) || `${withoutTrailingSlash(baseUrl)}/models`
    const response = await fetchJson(listUrl, headers, OpenAIModelsResponseSchema)
    seeds = response.data.map((model) => ({
      modelId: model.id,
      ownedBy: model.owned_by
    }))
  }

  return dedupeSeeds(seeds).map((item) => toBaseModel(provider.id, item))
}
