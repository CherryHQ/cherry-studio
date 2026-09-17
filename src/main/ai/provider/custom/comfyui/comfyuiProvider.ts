import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'

import { createImageGenerationModel } from '../imageGenerationModel'
import { createComfyuiTransport, DEFAULT_COMFYUI_BASE_URL } from './comfyuiTransport'

export const COMFYUI_PROVIDER_NAME = 'comfyui' as const

export interface ComfyuiProviderSettings {
  /** ComfyUI is a local server with no auth; accepted for symmetry, never read. */
  apiKey?: string
  /** ComfyUI host, e.g. `http://localhost:8188`. */
  baseURL?: string
  /** Overrides `baseURL` for the generation transport. */
  imageBaseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface ComfyuiProvider extends ProviderV3 {
  imageModel(modelId: string): ImageModelV3
}

/**
 * ComfyUI serves image generation only. `ProviderV3` still requires the chat
 * and embedding factories, so they throw rather than resolve to a host that
 * would answer them with an HTML page.
 */
export function createComfyuiProvider(settings: ComfyuiProviderSettings = {}): ComfyuiProvider {
  const unsupported = (surface: string) => () => {
    throw new Error(`ComfyUI does not serve ${surface}. Use a workflow from the paintings page instead.`)
  }

  const transport = createComfyuiTransport({
    baseURL: settings.imageBaseURL || settings.baseURL || DEFAULT_COMFYUI_BASE_URL
  })

  const provider = {
    specificationVersion: 'v3' as const,
    languageModel: unsupported('chat completions') as unknown as (modelId: string) => LanguageModelV3,
    embeddingModel: unsupported('embeddings') as unknown as (modelId: string) => EmbeddingModelV3,
    imageModel: (modelId: string) => createImageGenerationModel(modelId, { provider: COMFYUI_PROVIDER_NAME, transport })
  }

  return provider
}
