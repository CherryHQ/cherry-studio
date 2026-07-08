import type { ImageModelV3 } from '@ai-sdk/provider'
import { withoutTrailingSlash } from '@ai-sdk/provider-utils'
import { createOllama, type OllamaProvider, type OllamaProviderSettings } from 'ollama-ai-provider-v2'

import { createImageGenerationModel } from '../imageGenerationModel'
import { createOllamaTransport } from './ollamaTransport'

export const OLLAMA_PROVIDER_NAME = 'ollama' as const

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/api'

/**
 * Wraps `ollama-ai-provider-v2`'s chat/embedding provider with a real
 * `imageModel()` — the upstream package has no image-generation support.
 * Ollama's own image models (`x/z-image-turbo`, `x/flux2-klein`, …) generate
 * through the same `/api/generate` endpoint as text completion, wired here via
 * the single-shot `createImageGenerationModel + createOllamaTransport` pair
 * (mirrors `ovmsProvider.ts`, the other local-runtime image model).
 */
export function createOllamaWithImageModel(settings: OllamaProviderSettings = {}): OllamaProvider {
  const provider = createOllama(settings)

  const baseURL = withoutTrailingSlash(settings.baseURL) ?? DEFAULT_OLLAMA_BASE_URL
  const transport = createOllamaTransport({ baseURL, headers: settings.headers })

  provider.imageModel = (modelId: string): ImageModelV3 =>
    createImageGenerationModel(modelId, { provider: OLLAMA_PROVIDER_NAME, transport })

  return provider
}
