import { VoyageEmbeddings } from '@langchain/community/embeddings/voyage'
import type { Embeddings } from '@langchain/core/embeddings'
import { OllamaEmbeddings } from '@langchain/ollama'
import { AzureOpenAIEmbeddings, OpenAIEmbeddings } from '@langchain/openai'
import { ApiClient, SystemProviderIds } from '@types'

import { isJinaEmbeddingsModel, JinaEmbeddings } from './JinaEmbeddings'

export default class EmbeddingsFactory {
  static create({ embedApiClient, dimensions }: { embedApiClient: ApiClient; dimensions?: number }): Embeddings {
    const batchSize = 10
    const { model, provider, apiKey, apiVersion, baseURL } = embedApiClient
    if (provider === SystemProviderIds.ollama) {
      let baseUrl = baseURL
      if (baseURL.includes('v1/')) {
        baseUrl = baseURL.replace('v1/', '')
      }
      const headers = apiKey
        ? {
            Authorization: `Bearer ${apiKey}`
          }
        : undefined
      return new OllamaEmbeddings({
        model: model,
        baseUrl,
        ...headers
      })
    } else if (provider === SystemProviderIds.voyageai) {
      return new VoyageEmbeddings({
        modelName: model,
        apiKey,
        outputDimension: dimensions,
        batchSize
      })
    }
    if (isJinaEmbeddingsModel(model)) {
      return new JinaEmbeddings({
        model,
        apiKey,
        batchSize,
        dimensions,
        baseUrl: baseURL
      })
    }
    if (apiVersion !== undefined) {
      return new AzureOpenAIEmbeddings({
        azureOpenAIApiKey: apiKey,
        azureOpenAIApiVersion: apiVersion,
        azureOpenAIApiDeploymentName: model,
        azureOpenAIEndpoint: baseURL,
        dimensions,
        batchSize
      })
    }
    return new OpenAIEmbeddings({
      model,
      apiKey,
      dimensions,
      batchSize,
      configuration: { baseURL }
    })
  }
}
