import OpenAI from '@cherrystudio/openai'
import { Provider } from '@renderer/types'
import { OpenAISdkParams, OpenAISdkRawOutput } from '@renderer/types/sdk'

import { OpenAIAPIClient } from '../openai/OpenAIApiClient'

export class CherryAiAPIClient extends OpenAIAPIClient {
  constructor(provider: Provider) {
    super(provider)
  }

  override async createCompletions(
    payload: OpenAISdkParams,
    options?: OpenAI.RequestOptions
  ): Promise<OpenAISdkRawOutput> {
    const sdk = await this.getSdkInstance()
    options = options || {}
    options.headers = options.headers || {}

    const signature = await window.api.cherryai.generateSignature({
      method: 'POST',
      path: '/chat/completions',
      query: '',
      body: payload
    })

    options.headers = {
      ...options.headers,
      ...signature
    }

    // @ts-ignore - SDK参数可能有额外的字段
    return await sdk.chat.completions.create(payload, options)
  }

  override getClientCompatibilityType(): string[] {
    return ['CherryAiAPIClient']
  }

  public async listModels(): Promise<OpenAI.Models.Model[]> {
    const models = ['glm-4.5-flash', 'Qwen/Qwen3-8B']

    const created = Date.now()
    return models.map((id) => ({
      id,
      owned_by: 'cherryai',
      object: 'model' as const,
      created
    }))
  }
}
