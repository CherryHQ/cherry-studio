import { Assistant, Model, Provider, Suggestion } from '@renderer/types'
import { Message } from '@renderer/types/newMessage'
import OpenAI from 'openai'

import { CompletionsParams } from '.'
import AnthropicProvider from './AnthropicProvider'
import BaseProvider from './BaseProvider'
import GeminiProvider from './GeminiProvider'
import OpenAIProvider from './OpenAIProvider'

/**
 * AihubmixProvider - 根据模型类型自动选择合适的提供商
 * 使用装饰器模式实现
 */
export default class AihubmixProvider extends BaseProvider {
  private providers: Map<string, BaseProvider> = new Map()
  private defaultProvider: BaseProvider

  constructor(provider: Provider) {
    super(provider)

    // 初始化各个提供商
    this.providers.set('claude', new AnthropicProvider(provider))
    this.providers.set('gemini', new GeminiProvider({ ...provider, apiHost: 'https://aihubmix.com/gemini' }))
    this.providers.set('default', new OpenAIProvider(provider))

    // 设置默认提供商
    this.defaultProvider = this.providers.get('default')!
  }

  /**
   * 根据模型ID获取合适的提供商
   */
  private getProvider(modelId: string = ''): BaseProvider {
    const id = modelId.toLowerCase()

    if (id.includes('claude')) return this.providers.get('claude')!
    if (id.includes('gemini')) return this.providers.get('gemini')!

    return this.defaultProvider
  }

  // 直接使用默认提供商的方法
  public async models(): Promise<OpenAI.Models.Model[]> {
    return this.defaultProvider.models()
  }

  public async generateText(params: { prompt: string; content: string }): Promise<string> {
    return this.defaultProvider.generateText(params)
  }

  public async generateImage(params: any): Promise<string[]> {
    return this.defaultProvider.generateImage(params)
  }

  public async generateImageByChat(params: any): Promise<void> {
    return this.defaultProvider.generateImageByChat(params)
  }

  public async completions(params: CompletionsParams): Promise<void> {
    const modelId = params.assistant.model?.id || ''
    return this.getProvider(modelId).completions(params)
  }

  public async translate(
    content: string,
    assistant: Assistant,
    onResponse?: (text: string, isComplete: boolean) => void
  ): Promise<string> {
    return this.getProvider(assistant.model?.id).translate(content, assistant, onResponse)
  }

  public async summaries(messages: Message[], assistant: Assistant): Promise<string> {
    return this.getProvider(assistant.model?.id).summaries(messages, assistant)
  }

  public async summaryForSearch(messages: Message[], assistant: Assistant): Promise<string | null> {
    return this.getProvider(assistant.model?.id).summaryForSearch(messages, assistant)
  }

  public async suggestions(messages: Message[], assistant: Assistant): Promise<Suggestion[]> {
    return this.getProvider(assistant.model?.id).suggestions(messages, assistant)
  }

  public async check(model: Model, stream: boolean = false): Promise<{ valid: boolean; error: Error | null }> {
    return this.getProvider(model.id).check(model, stream)
  }

  public async getEmbeddingDimensions(model: Model): Promise<number> {
    return this.getProvider(model.id).getEmbeddingDimensions(model)
  }
}
