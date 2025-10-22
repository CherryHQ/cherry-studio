import { Maybe } from './type'

export type ModelPricing = {
  input_per_million_tokens: number
  output_per_million_tokens: number
  currencySymbol?: string
}

export type ModelType = 'text' | 'vision' | 'embedding' | 'reasoning' | 'function_calling' | 'web_search' | 'rerank'

export type ModelTag = Exclude<ModelType, 'text'> | 'free'

export type EndpointType = 'openai' | 'openai-response' | 'anthropic' | 'gemini' | 'image-generation' | 'jina-rerank'

export type ModelCapability = {
  type: ModelType
  /**
   * 是否为用户手动选择，如果为true，则表示用户手动选择了该类型，否则表示用户手动禁止了该模型；如果为undefined，则表示使用默认值
   * Is it manually selected by the user? If true, it means the user manually selected this type; otherwise, it means the user  * manually disabled the model.
   */
  isUserSelected?: boolean
}

export type Model = {
  id: string
  provider: string
  name: string
  group: string
  owned_by?: string
  description?: string
  capabilities?: ModelCapability[]
  /**
   * @deprecated
   */
  type?: ModelType[]
  pricing?: ModelPricing
  endpoint_type?: EndpointType
  supported_endpoint_types?: EndpointType[]
  supported_text_delta?: boolean
}

export type BaseUsage = {
  // the sum of some Modal input usage
  inputTokens: Maybe<number>
  // the sum of some Modal output usage
  outputTokens: Maybe<number>
  totalTokens: Maybe<number>
  cost?: number
}

export type LanguageModelUsage = BaseUsage & {
  reasoningTokens?: number
  cacheTokens?: number
}

export type ImageModelUsage = BaseUsage & {
  imageTokens?: number
  textTokens?: number
}

export type Metrics = {
  time_completion_millsec: number
  time_first_token_millsec?: number
  time_thinking_millsec?: number
}

export type Usage = LanguageModelUsage | ImageModelUsage

/**
 * 适用于其他sdk的模型客户端配置
 * Model client configuration suitable for other SDKs
 */
export type ApiClient = {
  model: string
  provider: string
  apiKey: string
  apiVersion?: string
  baseURL: string
}
