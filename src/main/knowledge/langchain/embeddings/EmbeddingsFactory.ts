import { VoyageEmbeddings } from '@langchain/community/embeddings/voyage'
import type { Embeddings } from '@langchain/core/embeddings'
import { OllamaEmbeddings } from '@langchain/ollama'
import { AzureOpenAIEmbeddings, OpenAIEmbeddings } from '@langchain/openai'
import { VOYAGE_SUPPORTED_DIM_MODELS } from '@main/knowledge/embedjs/embeddings/utils'
import { ApiClient } from '@types'

export default class EmbeddingsFactory {
  static create({ embedApiClient, dimensions }: { embedApiClient: ApiClient; dimensions?: number }): Embeddings {
    const batchSize = 10
    const { model, provider, apiKey, apiVersion, baseURL } = embedApiClient
    if (provider === 'ollama') {
      return new OllamaEmbeddings({
        model,
        baseUrl: baseURL
      })
    } else if (provider === 'voyageai') {
      return new VoyageEmbeddings({
        modelName: model,
        apiKey,
        outputDimension: VOYAGE_SUPPORTED_DIM_MODELS.includes(model) ? dimensions : undefined,
        batchSize: 8
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
