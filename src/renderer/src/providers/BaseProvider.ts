import { getOllamaKeepAliveTime } from '@renderer/hooks/useOllama'
import { Assistant, Message, Provider, Suggestion } from '@renderer/types'
import { delay } from '@renderer/utils'
import OpenAI from 'openai'

export default abstract class BaseProvider {
  protected provider: Provider
  protected host: string

  constructor(provider: Provider) {
    this.provider = provider
    this.host = this.getBaseURL()
  }

  public getBaseURL(): string {
    const host = this.provider.apiHost
    return host.endsWith('/') ? host : `${host}/v1/`
  }

  public defaultHeaders() {
    return {
      'X-Api-Key': this.provider.apiKey
    }
  }

  public get keepAliveTime() {
    return this.provider.id === 'ollama' ? getOllamaKeepAliveTime() : undefined
  }

  public async fakeCompletions({ onChunk }: CompletionsParams) {
    for (let i = 0; i < 100; i++) {
      await delay(0.01)
      onChunk({ text: i + '\n', usage: { completion_tokens: 0, prompt_tokens: 0, total_tokens: 0 } })
    }
  }

  abstract completions({ messages, assistant, onChunk, onFilterMessages }: CompletionsParams): Promise<void>
  abstract translate(message: Message, assistant: Assistant): Promise<string>
  abstract summaries(messages: Message[], assistant: Assistant): Promise<string>
  abstract suggestions(messages: Message[], assistant: Assistant): Promise<Suggestion[]>
  abstract generateText({ prompt, content }: { prompt: string; content: string }): Promise<string>
  abstract check(): Promise<{ valid: boolean; error: Error | null }>
  abstract models(): Promise<OpenAI.Models.Model[]>
  abstract generateImage(_params: {
    prompt: string
    negativePrompt: string
    imageSize: string
    batchSize: number
    seed?: string
    numInferenceSteps: number
    guidanceScale: number
    signal?: AbortSignal
  }): Promise<string[]>
}
