import type { BaseEmbeddings } from '@cherrystudio/embedjs-interfaces'
import { OllamaEmbeddings } from '@cherrystudio/embedjs-ollama'
import { OpenAiEmbeddings } from '@cherrystudio/embedjs-openai'
import type { ApiClient } from '@types'
import { net } from 'electron'

import { VoyageEmbeddings } from './VoyageEmbeddings'

export default class EmbeddingsFactory {
  static create({ embedApiClient }: { embedApiClient: ApiClient }): BaseEmbeddings {
    const batchSize = 10
    const { model, provider, apiKey, baseURL } = embedApiClient
    if (provider === 'voyageai') {
      return new VoyageEmbeddings({
        modelName: model,
        apiKey,
        batchSize: 8
      })
    }
    if (provider === 'ollama') {
      return new OllamaEmbeddings({
        model,
        baseUrl: baseURL.replace(/\/api$/, '')
      })
    }
    // NOTE: Azure OpenAI 也走 OpenAIEmbeddings, baseURL是https://xxxx.openai.azure.com/openai/v1
    return new OpenAiEmbeddings({
      model,
      apiKey,
      batchSize,
      configuration: { baseURL, fetch: net.fetch as typeof fetch }
    })
  }
}
