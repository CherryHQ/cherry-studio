import * as z from 'zod'

export type ModelType = 'text' | 'vision' | 'embedding' | 'reasoning' | 'function_calling' | 'web_search' | 'rerank'

export type ModelTag = Exclude<ModelType, 'text'> | 'free'

// "image-generation" is also openai endpoint, but specifically for image generation.
export const EndPointTypeSchema = z.enum([
  'openai',
  'openai-response',
  'anthropic',
  'gemini',
  'image-generation',
  'jina-rerank'
])
export type EndpointType = z.infer<typeof EndPointTypeSchema>

export type ModelPricing = {
  input_per_million_tokens: number
  output_per_million_tokens: number
  currencySymbol?: string
}

export type ModelCapability = {
  type: ModelType
  /**
   * Whether the type is manually selected by the user. `true` = the user manually selected this
   * type; `false` = the user manually disabled it; `undefined` = use the default.
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

export type ApiClient = {
  model: string
  provider: string
  apiKey: string
  apiVersion?: string
  baseURL: string
}
