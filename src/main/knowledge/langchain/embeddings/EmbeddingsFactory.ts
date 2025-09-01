import { VoyageEmbeddings } from '@langchain/community/embeddings/voyage'
import type { Embeddings } from '@langchain/core/embeddings'
import { OllamaEmbeddings } from '@langchain/ollama'
import { AzureOpenAIEmbeddings, OpenAIEmbeddings } from '@langchain/openai'
import { ApiClient } from '@types'

import { isJinaEmbeddingsModel, JinaEmbeddings } from './JinaEmbeddings'

export default class EmbeddingsFactory {
  static create({ embedApiClient, dimensions }: { embedApiClient: ApiClient; dimensions?: number }): Embeddings {
    const batchSize = 10
    const { model, provider, apiKey, apiVersion, baseURL } = embedApiClient
    if (provider === 'ollama') {
      if (baseURL.includes('v1/')) {
        return new OllamaEmbeddings({
          model: model,
          baseUrl: baseURL.replace('v1/', ''),
          requestOptions: {
            // @ts-ignore expected
            'encoding-format': 'float'
          }
        })
      }
      return new OllamaEmbeddings({
        model: model,
        baseUrl: baseURL,
        requestOptions: {
          // @ts-ignore expected
          'encoding-format': 'float'
        }
      })
    } else if (provider === 'voyageai') {
      return new VoyageEmbeddings({
        modelName: model,
        apiKey,
        outputDimension: dimensions,
        batchSize: 8
      })
    }
    if (isJinaEmbeddingsModel(model)) {
      return new JinaEmbeddings({
        model: model,
        apiKey,
        batchSize: batchSize,
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
