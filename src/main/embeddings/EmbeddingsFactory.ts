import type { BaseEmbeddings } from '@cherrystudio/embedjs-interfaces'
import { OllamaEmbeddings } from '@cherrystudio/embedjs-ollama'
import { OpenAiEmbeddings } from '@cherrystudio/embedjs-openai'
import { AzureOpenAiEmbeddings } from '@cherrystudio/embedjs-openai/src/azure-openai-embeddings'
import { getInstanceName } from '@main/utils'
import { KnowledgeBaseParams } from '@types'

import { SUPPORTED_DIM_MODELS as VOYAGE_SUPPORTED_DIM_MODELS, VoyageEmbeddings } from './VoyageEmbeddings'

export default class EmbeddingsFactory {
  static create({ model, provider, apiKey, apiVersion, baseURL, dimensions }: KnowledgeBaseParams): BaseEmbeddings {
    const batchSize = 10
    if (provider === 'voyageai') {
      if (VOYAGE_SUPPORTED_DIM_MODELS.includes(model)) {
        return new VoyageEmbeddings({
          modelName: model,
          apiKey,
          outputDimension: dimensions,
          batchSize: 8
        })
      } else {
        return new VoyageEmbeddings({
          modelName: model,
          apiKey,
          batchSize: 8
        })
      }
    }
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
    }
    if (apiVersion !== undefined) {
      return new AzureOpenAiEmbeddings({
        azureOpenAIApiKey: apiKey,
        azureOpenAIApiVersion: apiVersion,
        azureOpenAIApiDeploymentName: model,
        azureOpenAIApiInstanceName: getInstanceName(baseURL),
        dimensions,
        batchSize
      })
    }
    return new OpenAiEmbeddings({
      model,
      apiKey,
      dimensions,
      batchSize,
      configuration: { baseURL }
    })
  }
}
