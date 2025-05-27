import { GenerateImagesParameters } from '@google/genai'
import BaseProvider from '@renderer/providers/AiProvider/BaseProvider'
import ProviderFactory from '@renderer/providers/AiProvider/ProviderFactory'
import type { Assistant, GenerateImageParams, MCPTool, Model, Provider, Suggestion } from '@renderer/types'
import { Chunk } from '@renderer/types/chunk'
import type { Message } from '@renderer/types/newMessage'
import OpenAI from 'openai'
import { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources'
import type { Stream } from 'openai/streaming'

export type OnFilterMessagesFunction = (messages: Message[]) => void

export interface CompletionsParams {
  messages: Message[]
  assistant: Assistant
  onChunk: (chunk: Chunk) => void
  onFilterMessages: OnFilterMessagesFunction
  mcpTools?: MCPTool[]
  _internal?: {
    // SDK接口需要的参数
    sdkParams?: {
      reqMessages: ChatCompletionMessageParam[]
      tools: ChatCompletionTool[]
      systemMessage: any
      model: any
      maxTokens: number | undefined
      streamOutput: boolean
    }
    // 内部处理需要的参数
    enableReasoning?: boolean
    userMessages?: ChatCompletionMessageParam[]
    contextCount?: number
    processedMessages?: Message[]
    // Abort控制器
    controller?: AbortController
  }
}

// Re-export CompletionsResult
export interface CompletionsOpenAIResult {
  stream: // openai sdk stream
  | (OpenAI.Chat.Completions.ChatCompletion & {
        _request_id?: string | null
      } & Stream<OpenAI.Chat.Completions.ChatCompletionChunk>)
    // our app-specific stream
    | ReadableStream<OpenAI.Chat.Completions.ChatCompletionChunk>
    | ReadableStream<Chunk>
    | ReadableStream<Chunk | OpenAI.Chat.Completions.ChatCompletionChunk>
  // 添加 abort controller 用于中间件处理和控制 abort 事件
  controller?: AbortController
}

export default class AiProvider {
  private sdk: BaseProvider

  constructor(provider: Provider) {
    this.sdk = ProviderFactory.create(provider)
  }

  public async fakeCompletions(params: CompletionsParams): Promise<void> {
    return this.sdk.fakeCompletions(params)
  }

  public async completions(params: CompletionsParams): Promise<CompletionsOpenAIResult> {
    return this.sdk.completions(params)
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
