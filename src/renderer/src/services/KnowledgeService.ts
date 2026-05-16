import { loggerService } from '@logger'
import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import { type KnowledgeBase, type KnowledgeBaseParams, SystemProviderIds } from '@renderer/types'
import { routeToEndpoint } from '@renderer/utils'
import { isAzureOpenAIProvider, isGeminiProvider } from '@renderer/utils/provider'
import { getRotatedProviderApiKey } from '@renderer/utils/providerAuth'
import { formatProviderApiHost } from '@renderer/utils/providerHost'

import { getProviderByModel } from './AssistantService'

const logger = loggerService.withContext('RendererKnowledgeService')

export const getKnowledgeBaseParams = (base: KnowledgeBase): KnowledgeBaseParams => {
  const embedProviderRaw = getProviderByModel(base.model)
  const rerankProviderRaw = getProviderByModel(base.rerankModel)
  if (!embedProviderRaw) {
    throw new Error(`Knowledge base ${base.name}: embedding model provider not found`)
  }
  if (!rerankProviderRaw) {
    throw new Error(`Knowledge base ${base.name}: rerank model provider not found`)
  }
  const embedProvider = formatProviderApiHost(embedProviderRaw)
  const rerankProvider = formatProviderApiHost(rerankProviderRaw)

  let { baseURL } = routeToEndpoint(embedProvider.apiHost)

  const rerankHost = rerankProvider.apiHost
  if (isGeminiProvider(embedProvider)) {
    baseURL = baseURL + '/openai'
  } else if (isAzureOpenAIProvider(embedProvider)) {
    baseURL = baseURL + '/v1'
  } else if (embedProvider.id === SystemProviderIds.ollama) {
    // LangChain生态不需要/api结尾的URL
    baseURL = baseURL.replace(/\/api$/, '')
  }

  logger.info(`Knowledge base ${base.name} using baseURL: ${baseURL}`)

  let chunkSize = base.chunkSize
  const maxChunkSize = getEmbeddingMaxContext(base.model.id)

  if (maxChunkSize) {
    if (chunkSize && chunkSize > maxChunkSize) {
      chunkSize = maxChunkSize
    }
    if (!chunkSize && maxChunkSize < 1024) {
      chunkSize = maxChunkSize
    }
  }

  return {
    id: base.id,
    dimensions: base.dimensions,
    embedApiClient: {
      model: base.model.id,
      provider: base.model.provider,
      apiKey: getRotatedProviderApiKey(embedProvider) || 'secret',
      baseURL
    },
    chunkSize,
    chunkOverlap: base.chunkOverlap,
    rerankApiClient: {
      model: base.rerankModel?.id || '',
      provider: rerankProvider.name.toLowerCase(),
      apiKey: getRotatedProviderApiKey(rerankProvider) || 'secret',
      baseURL: rerankHost
    },
    documentCount: base.documentCount
  }
}
