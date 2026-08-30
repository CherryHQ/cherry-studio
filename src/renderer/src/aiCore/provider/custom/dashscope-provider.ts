import { OpenAICompatibleChatLanguageModel, OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import type {
  EmbeddingModelV3,
  ImageModelV3,
  ImageModelV3CallOptions,
  LanguageModelV3,
  ProviderV3
} from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import {
  combineHeaders,
  convertImageModelFileToDataUri,
  loadApiKey,
  withoutTrailingSlash
} from '@ai-sdk/provider-utils'

export const DASHSCOPE_PROVIDER_NAME = 'dashscope' as const

export interface DashScopeProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface DashScopeProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  imageModel(modelId: string): ImageModelV3
}

type DashScopeImageOptions = {
  negativePrompt?: string
  promptExtend?: boolean
}

type DashScopeImageResponse = {
  output?: {
    choices?: Array<{ message?: { content?: Array<{ image?: string }> } }>
  }
}

function imageBaseUrl(baseURL: string): string {
  return (withoutTrailingSlash(baseURL) ?? baseURL).replace(/\/compatible-mode\/v1$/, '')
}

class DashScopeImageModel implements ImageModelV3 {
  readonly specificationVersion = 'v3' as const
  readonly provider = `${DASHSCOPE_PROVIDER_NAME}.image`
  readonly maxImagesPerCall = 6

  constructor(
    readonly modelId: string,
    private readonly settings: Required<Pick<DashScopeProviderSettings, 'baseURL'>> & DashScopeProviderSettings
  ) {}

  async doGenerate(options: ImageModelV3CallOptions): Promise<Awaited<ReturnType<ImageModelV3['doGenerate']>>> {
    const fetch = this.settings.fetch ?? globalThis.fetch
    const apiKey = loadApiKey({
      apiKey: this.settings.apiKey,
      environmentVariableName: 'DASHSCOPE_API_KEY',
      description: 'DashScope'
    })
    const providerOptions = (options.providerOptions.dashscope ?? {}) as DashScopeImageOptions
    const content: Array<{ text?: string; image?: string }> = []
    if (options.prompt) content.push({ text: options.prompt })
    for (const file of options.files ?? []) content.push({ image: convertImageModelFileToDataUri(file) })

    const parameters = {
      ...(options.size ? { size: options.size.replace('x', '*') } : {}),
      ...(options.n > 1 ? { n: options.n } : {}),
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      ...(providerOptions.negativePrompt ? { negative_prompt: providerOptions.negativePrompt } : {}),
      ...(providerOptions.promptExtend !== undefined ? { prompt_extend: providerOptions.promptExtend } : {})
    }
    const requestHeaders = Object.fromEntries(
      Object.entries(
        combineHeaders(
          { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          this.settings.headers,
          options.headers
        )
      ).filter((entry): entry is [string, string] => entry[1] !== undefined)
    )
    const response = await fetch(
      `${imageBaseUrl(this.settings.baseURL)}/api/v1/services/aigc/multimodal-generation/generation`,
      {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          model: this.modelId,
          input: { messages: [{ role: 'user', content }] },
          ...(Object.keys(parameters).length > 0 ? { parameters } : {})
        }),
        signal: options.abortSignal
      }
    )

    if (!response.ok) {
      throw new Error(`DashScope image request failed with status ${response.status}`)
    }

    const payload = (await response.json()) as DashScopeImageResponse
    const imageUrls = (payload.output?.choices ?? [])
      .flatMap((choice) => choice.message?.content ?? [])
      .map((part) => part.image)
      .filter((url): url is string => Boolean(url))
    const images = await Promise.all(
      imageUrls.map(async (url) => {
        const imageResponse = await fetch(url, { signal: options.abortSignal })
        if (!imageResponse.ok) throw new Error(`DashScope image download failed with status ${imageResponse.status}`)
        return new Uint8Array(await imageResponse.arrayBuffer())
      })
    )

    return {
      images,
      warnings: [],
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
        headers: Object.fromEntries(response.headers.entries())
      }
    }
  }
}

export function createDashScope(options: DashScopeProviderSettings = {}): DashScopeProvider {
  const baseURL = options.baseURL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  const resolveApiKey = () =>
    loadApiKey({ apiKey: options.apiKey, environmentVariableName: 'DASHSCOPE_API_KEY', description: 'DashScope' })
  const headers = () => ({ Authorization: `Bearer ${resolveApiKey()}`, ...options.headers })
  const url = ({ path }: { path: string }) => `${withoutTrailingSlash(baseURL)}${path}`
  const languageModel = (modelId: string): LanguageModelV3 =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${DASHSCOPE_PROVIDER_NAME}.chat`,
      url,
      headers,
      fetch: options.fetch
    })

  const provider = (modelId: string) => languageModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = languageModel
  provider.embeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${DASHSCOPE_PROVIDER_NAME}.embedding`,
      url,
      headers,
      fetch: options.fetch
    })
  provider.imageModel = (modelId: string) => new DashScopeImageModel(modelId, { ...options, baseURL })

  return provider as DashScopeProvider
}
