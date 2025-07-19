import type { BaseEmbeddings } from '@cherrystudio/embedjs-interfaces'
import { OllamaEmbeddings } from '@cherrystudio/embedjs-ollama'
import { OpenAiEmbeddings } from '@cherrystudio/embedjs-openai'
import { AzureOpenAiEmbeddings } from '@cherrystudio/embedjs-openai/src/azure-openai-embeddings'
import { getInstanceName } from '@main/utils'
import { ApiClient } from '@types'

import { EMBEDDING_MODEL_DEFAULT_DIMS, getLowerBaseModelName, VOYAGE_SUPPORTED_DIM_MODELS } from './utils'
import { VoyageEmbeddings } from './VoyageEmbeddings'

export default class EmbeddingsFactory {
  static create({
    embedApiClient,
    dimensions,
    isAutoDimensions
  }: {
    embedApiClient: ApiClient
    dimensions?: number
    isAutoDimensions?: boolean
  }): BaseEmbeddings {
    const batchSize = 10
    const { model, provider, apiKey, apiVersion, baseURL } = embedApiClient
    if (provider === 'voyageai') {
      const newDimensions = isAutoDimensions
        ? undefined
        : VOYAGE_SUPPORTED_DIM_MODELS.includes(model)
          ? dimensions
          : undefined
      return new VoyageEmbeddings({
        modelName: model,
        apiKey,
        outputDimension: newDimensions,
        batchSize: 8
      })
    }
    if (provider === 'ollama') {
      if (baseURL.includes('v1/')) {
        return new OllamaEmbeddings({
          model: model,
          baseUrl: baseURL.replace('v1/', ''),
          requestOptions: {
            // @ts-ignore expected
            encoding_format: 'float'
          }
        })
      }
      return new OllamaEmbeddings({
        model: model,
        baseUrl: baseURL,
        requestOptions: {
          // @ts-ignore expected
          encoding_format: 'float'
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

    let newDimensions: number | undefined = dimensions

    // 兼容旧版本无autoDims字段的知识库
    if (isAutoDimensions) {
      newDimensions = undefined
    } else {
      const baseModelName = getLowerBaseModelName(model)
      if (dimensions === EMBEDDING_MODEL_DEFAULT_DIMS[baseModelName]) {
        newDimensions = undefined
      }
    }

    return new OpenAiEmbeddings({
      model,
      apiKey,
      dimensions: newDimensions,
      batchSize,
      configuration: { baseURL }
    })
  }
}
