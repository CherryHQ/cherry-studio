import type { ImageModelV3, ProviderV3 } from '@ai-sdk/provider'
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
  const unsupported = (surface: string): never => {
    throw new Error(`ComfyUI does not serve ${surface}. Use a workflow from the paintings page instead.`)
  }

  const transport = createComfyuiTransport({
    baseURL: settings.imageBaseURL || settings.baseURL || DEFAULT_COMFYUI_BASE_URL,
    headers: settings.headers,
    fetch: settings.fetch
  })

  // The factories are typed by the interface rather than cast into it: a
  // `never`-returning body satisfies both model types, so the contract stays
  // checked instead of erased by an `unknown` hop.
  const provider: ComfyuiProvider = {
    specificationVersion: 'v3',
    languageModel: () => unsupported('chat completions'),
    embeddingModel: () => unsupported('embeddings'),
    imageModel: (modelId: string) => createImageGenerationModel(modelId, { provider: COMFYUI_PROVIDER_NAME, transport })
  }

  return provider
}
