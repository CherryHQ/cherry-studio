import { loggerService } from '@logger'
import { Provider } from '@renderer/types'
import { GenerateImageParams } from '@renderer/types'
import OpenAI from 'openai'

import { OpenAIAPIClient } from '../openai/OpenAIApiClient'

const logger = loggerService.withContext('ZhipuAPIClient')

export class ZhipuAPIClient extends OpenAIAPIClient {
  constructor(provider: Provider) {
    super(provider)
  }

  override getClientCompatibilityType(): string[] {
    return ['ZhipuAPIClient']
  }

  override async generateImage({
    model,
    prompt,
    negativePrompt,
    imageSize,
    batchSize,
    signal,
    quality
  }: GenerateImageParams): Promise<string[]> {
    const sdk = await this.getSdkInstance()

    // 智谱AI使用不同的参数格式
    const body: any = {
      model,
      prompt
    }

    // 智谱AI特有的参数格式
    body.size = imageSize
    body.n = batchSize
    if (negativePrompt) {
      body.negative_prompt = negativePrompt
    }

    // 只有cogview-4-250304模型支持quality和style参数
    if (model === 'cogview-4-250304') {
      if (quality) {
        body.quality = quality
      }
      body.style = 'vivid'
    }

    try {
      logger.debug('Calling Zhipu image generation API with params:', body)

      const response = await sdk.images.generate(body, { signal })

      if (response.data && response.data.length > 0) {
        return response.data.map((image: any) => image.url).filter(Boolean)
      }

      return []
    } catch (error) {
      logger.error('Zhipu image generation failed:', error as Error)
      throw error
    }
  }

  public async listModels(): Promise<OpenAI.Models.Model[]> {
    const models = [
      'glm-4.5',
      'glm-4.5-x',
      'glm-4.5-air',
      'glm-4.5-airx',
      'glm-4.5-flash',
      'glm-4.5v',
      'glm-z1-air',
      'glm-z1-airx',
      'cogview-3-flash',
      'cogview-4-250304',
      'glm-4-long',
      'glm-4-plus',
      'glm-4-air-250414',
      'glm-4-airx',
      'glm-4-flashx',
      'glm-4v',
      'glm-4v-flash',
      'glm-4v-plus-0111',
      'glm-4.1v-thinking-flash',
      'glm-4-alltools',
      'embedding-3'
    ]

    const created = Date.now()
    return models.map((id) => ({
      id,
      owned_by: 'zhipu',
      object: 'model' as const,
      created
    }))
  }
}
