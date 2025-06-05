import { ApiClientFactory } from '@renderer/providers/AiProvider/clients/ApiClientFactory'
import { BaseApiClient } from '@renderer/providers/AiProvider/clients/BaseApiClient'
import type { Assistant, GenerateImageParams, Model, Provider, Suggestion } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import OpenAI from 'openai'

import { CompletionsMiddlewareBuilder } from '../middleware/builder'
import { applyCompletionsMiddlewares } from '../middleware/composer'
import { CompletionsParams, CompletionsResult } from '../middleware/schemas'

export default class AiProvider {
  private apiClient: BaseApiClient

  constructor(provider: Provider) {
    // Use the new ApiClientFactory to get a BaseApiClient instance
    this.apiClient = ApiClientFactory.create(provider)
  }

  public async completions(params: CompletionsParams): Promise<CompletionsResult> {
    // 1. Build the middleware chain
    // TODO:动态选择
    const builder = CompletionsMiddlewareBuilder.withDefaults()
    const middlewares = builder.build()

    // 2. Create the wrapped SDK method with middlewares
    const wrappedCompletionMethod = applyCompletionsMiddlewares(
      this.apiClient,
      this.apiClient.createCompletions,
      middlewares
    )

    // 3. Execute the wrapped method with the original params
    return wrappedCompletionMethod(params)
  }

  public async translate(
    content: string,
    assistant: Assistant,
    onResponse?: (text: string, isComplete: boolean) => void
  ): Promise<string> {
    // TODO: Refactor using this.apiClient.createCompletions and middlewares
    console.warn('translate method needs refactoring')
    return Promise.reject('Not implemented')
    // return this.apiClient.translate(content, assistant, onResponse)
  }

  public async summaries(messages: Message[], assistant: Assistant): Promise<string> {
    // TODO: Refactor using this.apiClient.createCompletions and middlewares
    console.warn('summaries method needs refactoring')
    return Promise.reject('Not implemented')
    // return this.apiClient.summaries(messages, assistant)
  }

  public async summaryForSearch(messages: Message[], assistant: Assistant): Promise<string | null> {
    // TODO: Refactor using this.apiClient.createCompletions and middlewares
    console.warn('summaryForSearch method needs refactoring')
    return Promise.reject('Not implemented')
    // return this.apiClient.summaryForSearch(messages, assistant)
  }

  public async suggestions(messages: Message[], assistant: Assistant): Promise<Suggestion[]> {
    // TODO: Refactor using this.apiClient.createCompletions and middlewares
    console.warn('suggestions method needs refactoring')
    return Promise.reject('Not implemented')
    // return this.apiClient.suggestions(messages, assistant)
  }

  public async generateText({ prompt, content }: { prompt: string; content: string }): Promise<string> {
    // TODO: Refactor using this.apiClient.createCompletions and middlewares
    console.warn('generateText method needs refactoring')
    return Promise.reject('Not implemented')
    // return this.apiClient.generateText({ prompt, content })
  }

  public async check(model: Model, stream: boolean = false): Promise<{ valid: boolean; error: Error | null }> {
    // TODO: This method might need to be on ApiClient or handled differently
    console.warn('check method needs review for new architecture')
    return Promise.reject('Not implemented')
    // return this.apiClient.check(model, stream)
  }

  public async models(): Promise<OpenAI.Models.Model[]> {
    // TODO: This method might need to be on ApiClient or handled differently
    console.warn('models method needs review for new architecture')
    return Promise.reject('Not implemented')
    // return this.apiClient.models()
  }

  public getApiKey(): string {
    // TODO: Refactor: ApiKey should generally not be exposed directly from AiProvider/AiCoreService.
    // It can be accessed from the provider configuration if needed for other purposes.
    console.warn('getApiKey method needs refactoring')
    return 'deprecated'
    // return this.apiClient.getApiKey()
  }

  public async generateImage(params: GenerateImageParams): Promise<string[]> {
    // TODO: Refactor using this.apiClient (likely createCompletions with specific model/params) or a dedicated image generation method on ApiClient
    console.warn('generateImage method needs refactoring')
    return Promise.reject('Not implemented')
    // return this.apiClient.generateImage(params)
  }

  public async generateImageByChat({
    messages,
    assistant,
    onChunk,
    onFilterMessages
  }: CompletionsParams): Promise<void> {
    // TODO: Refactor using this.apiClient.createCompletions with specific model/params for image generation via chat
    console.warn('generateImageByChat method needs refactoring')
    return Promise.reject('Not implemented')
    // return this.apiClient.generateImageByChat({ messages, assistant, onChunk, onFilterMessages })
  }

  public async getEmbeddingDimensions(model: Model): Promise<number> {
    // TODO: This method might need to be on ApiClient or handled differently
    console.warn('getEmbeddingDimensions method needs review for new architecture')
    return Promise.reject('Not implemented')
    // return this.apiClient.getEmbeddingDimensions(model)
  }

  public getBaseURL(): string {
    // TODO: Refactor: BaseURL should generally not be exposed directly from AiProvider/AiCoreService.
    // It can be accessed from the provider configuration if needed for other purposes.
    console.warn('getBaseURL method needs refactoring')
    return 'deprecated'
    // return this.apiClient.getBaseURL()
  }
}
