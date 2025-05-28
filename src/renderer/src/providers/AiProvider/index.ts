import { GenerateImagesParameters } from '@google/genai'
import BaseProvider from '@renderer/providers/AiProvider/BaseProvider'
import ProviderFactory from '@renderer/providers/AiProvider/ProviderFactory'
import type { Assistant, GenerateImageParams, MCPTool, Model, Provider, Suggestion } from '@renderer/types'
import { Chunk } from '@renderer/types/chunk'
import type { Message } from '@renderer/types/newMessage'
import OpenAI from 'openai'

export interface CompletionsParams {
  messages: Message[]
  assistant: Assistant
  onChunk: (chunk: Chunk) => void
  onFilterMessages: (messages: Message[]) => void
  mcpTools?: MCPTool[]
}

export default class AiProvider {
  private sdk: BaseProvider

  constructor(provider: Provider) {
    this.sdk = ProviderFactory.create(provider)
  }

  public async fakeCompletions(params: CompletionsParams): Promise<void> {
    return this.sdk.fakeCompletions(params)
  }

  public async completions({
    messages,
    assistant,
    mcpTools,
    onChunk,
    onFilterMessages
  }: CompletionsParams): Promise<void> {
    return this.sdk.completions({ messages, assistant, mcpTools, onChunk, onFilterMessages })
  }

  public async translate(
    content: string,
    assistant: Assistant,
    onResponse?: (text: string, isComplete: boolean) => void
  ): Promise<string> {
    return this.sdk.translate(content, assistant, onResponse)
  }

  public async summaries(messages: Message[], assistant: Assistant): Promise<string> {
    return this.sdk.summaries(messages, assistant)
  }

  public async summaryForSearch(messages: Message[], assistant: Assistant): Promise<string | null> {
    return this.sdk.summaryForSearch(messages, assistant)
  }

  public async suggestions(messages: Message[], assistant: Assistant): Promise<Suggestion[]> {
    return this.sdk.suggestions(messages, assistant)
  }

  public async generateText({ prompt, content }: { prompt: string; content: string }): Promise<string> {
    return this.sdk.generateText({ prompt, content })
  }

  public async check(model: Model, stream: boolean = false): Promise<{ valid: boolean; error: Error | null }> {
    return this.sdk.check(model, stream)
  }

  public async models(): Promise<OpenAI.Models.Model[]> {
    return this.sdk.models()
  }

  public getApiKey(): string {
    return this.sdk.getApiKey()
  }

  public async generateImage(params: GenerateImageParams | GenerateImagesParameters): Promise<string[]> {
    return this.sdk.generateImage(params as GenerateImageParams)
  }

  public async generateImageByChat({
    messages,
    assistant,
    onChunk,
    onFilterMessages
  }: CompletionsParams): Promise<void> {
    return this.sdk.generateImageByChat({ messages, assistant, onChunk, onFilterMessages })
  }

  public async getEmbeddingDimensions(model: Model): Promise<number> {
    return this.sdk.getEmbeddingDimensions(model)
  }

  public getBaseURL(): string {
    return this.sdk.getBaseURL()
  }
}
