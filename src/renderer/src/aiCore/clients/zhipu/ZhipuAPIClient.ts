import { loggerService } from '@logger'
import { Provider } from '@renderer/types'
import { GenerateImageParams } from '@renderer/types'

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
}
