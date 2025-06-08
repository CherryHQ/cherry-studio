import type { Provider } from '@renderer/types'

import { ApiClient, ApiClientFactory } from './clients'

export default abstract class BaseProvider {
  protected provider: Provider
  protected apiClient: ApiClient<any, any, any, any>
  public useSystemPromptForTools: boolean = true

  constructor(provider: Provider) {
    this.provider = provider
    this.apiClient = ApiClientFactory.create(provider)
  }

  // abstract completions(params: CompletionsParams): Promise<CompletionsResult>
  // abstract translate(
  //   content: string,
  //   assistant: Assistant,
  //   onResponse?: (text: string, isComplete: boolean) => void
  // ): Promise<string>
  // abstract summaries(messages: Message[], assistant: Assistant): Promise<string>
  // abstract summaryForSearch(messages: Message[], assistant: Assistant): Promise<string | null>
  // abstract suggestions(messages: Message[], assistant: Assistant): Promise<Suggestion[]>
  // abstract generateText({ prompt, content }: { prompt: string; content: string }): Promise<string>
  // abstract check(model: Model, stream: boolean): Promise<{ valid: boolean; error: Error | null }>
  // abstract models(): Promise<OpenAI.Models.Model[]>
  // abstract generateImage(params: GenerateImageParams): Promise<string[]>
  // abstract generateImageByChat({ messages, assistant, onChunk }: CompletionsParams): Promise<void>
  // abstract getEmbeddingDimensions(model: Model): Promise<number>
  // abstract getMessageParam(message: Message, model?: Model): Promise<any>
}
