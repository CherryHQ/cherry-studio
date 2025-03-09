import BaseProvider from '@renderer/providers/BaseProvider'
import ProviderFactory from '@renderer/providers/ProviderFactory'
import { Assistant, GenerateImageParams, Message, Model, Provider, Suggestion } from '@renderer/types'
import OpenAI from 'openai'

import { CompletionsParams } from '.'

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
    onChunk,
    onFilterMessages,
    mcpTools
  }: CompletionsParams): Promise<void> {
    return this.sdk.completions({ messages, assistant, onChunk, onFilterMessages, mcpTools })
  }

  public async translate(message: Message, assistant: Assistant, onResponse?: (text: string) => void): Promise<string> {
    return this.sdk.translate(message, assistant, onResponse)
  }

  public async summaries(messages: Message[], assistant: Assistant): Promise<string> {
    return this.sdk.summaries(messages, assistant)
  }

  public async suggestions(messages: Message[], assistant: Assistant): Promise<Suggestion[]> {
    return this.sdk.suggestions(messages, assistant)
  }

  public async generateText({ prompt, content }: { prompt: string; content: string }): Promise<string> {
    return this.sdk.generateText({ prompt, content })
  }

  public async check(model: Model): Promise<{ valid: boolean; error: Error | null }> {
    return this.sdk.check(model)
  }

  public async models(): Promise<OpenAI.Models.Model[]> {
    return this.sdk.models()
  }

  public getApiKey(): string {
    return this.sdk.getApiKey()
  }

  public async generateImage(params: GenerateImageParams): Promise<string[]> {
    return this.sdk.generateImage(params)
  }

  public async getEmbeddingDimensions(model: Model): Promise<number> {
    return this.sdk.getEmbeddingDimensions(model)
  }

  public getBaseURL(): string {
    return this.sdk.getBaseURL()
  }
}
