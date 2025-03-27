import type { BaseEmbeddings } from '@cherrystudio/embedjs-interfaces'
import { OpenAiEmbeddings } from '@cherrystudio/embedjs-openai'
import { AzureOpenAiEmbeddings } from '@cherrystudio/embedjs-openai/src/azure-openai-embeddings'
import { getInstanceName } from '@main/utils'
import { KnowledgeBaseParams } from '@types'

import VoyageEmbeddings from './VoyageEmbeddings'

export default class EmbeddingsFactory {
  static create({ model, apiKey, apiVersion, baseURL, dimensions }: KnowledgeBaseParams): BaseEmbeddings {
    const batchSize = 10
    if (model.includes('voyage')) {
      return new VoyageEmbeddings({
        modelName: model,
        apiKey,
        outputDimension: dimensions,
        batchSize: 8
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
