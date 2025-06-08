import { ApiClientFactory } from '@renderer/providers/AiProvider/clients/ApiClientFactory'
import { BaseApiClient } from '@renderer/providers/AiProvider/clients/BaseApiClient'
import type { Provider } from '@renderer/types'
import { RequestOptions } from '@renderer/types/sdk'
import OpenAI from 'openai'

import { CompletionsMiddlewareBuilder } from '../middleware/builder'
import { applyCompletionsMiddlewares } from '../middleware/composer'
import { MIDDLEWARE_NAME as McpToolChunkMiddlewareName } from '../middleware/core/McpToolChunkMiddleware'
import { MIDDLEWARE_NAME as ThinkChunkMiddlewareName } from '../middleware/core/ThinkChunkMiddleware'
import { MIDDLEWARE_NAME as WebSearchMiddlewareName } from '../middleware/core/WebSearchMiddleware'
import { MIDDLEWARE_NAME as ThinkingTagExtractionMiddlewareName } from '../middleware/feat/ThinkingTagExtractionMiddleware'
import { MIDDLEWARE_NAME as ToolUseExtractionMiddlewareName } from '../middleware/feat/ToolUseExtractionMiddleware'
import { CompletionsParams, CompletionsResult } from '../middleware/schemas'

export default class AiProvider {
  private apiClient: BaseApiClient

  constructor(provider: Provider) {
    // Use the new ApiClientFactory to get a BaseApiClient instance
    this.apiClient = ApiClientFactory.create(provider)
  }

  public async completions(params: CompletionsParams, options?: RequestOptions): Promise<CompletionsResult> {
    // 1. Build the middleware chain
    const builder = CompletionsMiddlewareBuilder.withDefaults()
    if (!params.enableReasoning) {
      builder.remove(ThinkingTagExtractionMiddlewareName)
      builder.remove(ThinkChunkMiddlewareName)
    }
    if (!params.enableWebSearch) {
      builder.remove(WebSearchMiddlewareName)
    }
    if (!params.mcpTools?.length) {
      builder.remove(ToolUseExtractionMiddlewareName)
      builder.remove(McpToolChunkMiddlewareName)
    }

    const middlewares = builder.build()

    // 2. Create the wrapped SDK method with middlewares
    const wrappedCompletionMethod = applyCompletionsMiddlewares(
      this.apiClient,
      this.apiClient.createCompletions,
      middlewares
    )

    // 3. Execute the wrapped method with the original params
    return wrappedCompletionMethod(params, options)
  }

  public async models(): Promise<OpenAI.Models.Model[]> {
    // TODO: This method might need to be on ApiClient or handled differently
    console.warn('models method needs review for new architecture')
    return Promise.reject('Not implemented')
    // return this.apiClient.models()
  }

  // public async generateImage(params: GenerateImageParams): Promise<string[]> {
  //   // TODO: Refactor using this.apiClient (likely createCompletions with specific model/params) or a dedicated image generation method on ApiClient
  //   console.warn('generateImage method needs refactoring')
  //   return Promise.reject('Not implemented')
  //   // return this.apiClient.generateImage(params)
  // }

  // public async getEmbeddingDimensions(model: Model): Promise<number> {
  //   // TODO: This method might need to be on ApiClient or handled differently
  //   console.warn('getEmbeddingDimensions method needs review for new architecture')
  //   return Promise.reject('Not implemented')
  //   // return this.apiClient.getEmbeddingDimensions(model)
  // }
}
