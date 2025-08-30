import type { PersonGeneration } from '@google/genai'

export type ApiClient = {
  model: string
  provider: string
  apiKey: string
  apiVersion?: string
  baseURL: string
}
export interface ApiServerConfig {
  enabled: boolean
  host: string
  port: number
  apiKey: string
}
export type GenerateImageResponse = {
  type: 'url' | 'base64'
  images: string[]
}
export type GenerateImageParams = {
  model: string
  prompt: string
  negativePrompt?: string
  imageSize: string
  batchSize: number
  seed?: string
  numInferenceSteps?: number
  guidanceScale?: number
  signal?: AbortSignal
  promptEnhancement?: boolean
  personGeneration?: PersonGeneration
  quality?: string
}
