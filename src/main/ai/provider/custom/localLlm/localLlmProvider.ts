import {
  type LanguageModelV3,
  type LanguageModelV3CallOptions,
  type LanguageModelV3Content,
  type LanguageModelV3FinishReason,
  type LanguageModelV3GenerateResult,
  type LanguageModelV3StreamPart,
  type LanguageModelV3StreamResult,
  type LanguageModelV3Usage,
  type ProviderV3,
  type SharedV3Warning,
  UnsupportedFunctionalityError
} from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'

import { application } from '@application'
import type { LlmChatMessage, LlmGenerateEvent, LlmGenerateInput, LlmGenerateResult } from '@main/ai/localModel'
import { LOCAL_LLM_PROVIDER_ID } from '@shared/data/presets/localLlm'
import type { LocalModelBundleId } from '@shared/data/presets/localModel'

/**
 * `LanguageModelV3` over the `inference.llm` utility process. The model id is the
 * local-model bundle id; the prompt is flattened to text turns before it crosses the process.
 */
class LocalLlmLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3'
  readonly provider = LOCAL_LLM_PROVIDER_ID
  readonly supportedUrls = {}

  constructor(readonly modelId: string) {}

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    let text = ''
    let reasoning = ''
    const { result, warnings } = await this.generate(options, (event) => {
      if (event.type === 'text') text += event.delta
      else reasoning += event.delta
    })
    const content: LanguageModelV3Content[] = []
    if (reasoning) content.push({ type: 'reasoning', text: reasoning })
    if (text) content.push({ type: 'text', text })
    return { content, finishReason: toFinishReason(result), usage: toUsage(result), warnings }
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: async (controller) => {
        let open: { type: LlmGenerateEvent['type']; id: string } | undefined
        let parts = 0
        const closeOpenPart = () => {
          if (open) controller.enqueue({ type: open.type === 'text' ? 'text-end' : 'reasoning-end', id: open.id })
          open = undefined
        }
        try {
          const { result } = await this.generate(
            options,
            (event) => {
              if (open?.type !== event.type) {
                closeOpenPart()
                open = { type: event.type, id: String(parts++) }
                controller.enqueue({ type: event.type === 'text' ? 'text-start' : 'reasoning-start', id: open.id })
              }
              controller.enqueue({
                type: event.type === 'text' ? 'text-delta' : 'reasoning-delta',
                id: open.id,
                delta: event.delta
              })
            },
            (warnings) => controller.enqueue({ type: 'stream-start', warnings })
          )
          closeOpenPart()
          controller.enqueue({ type: 'finish', finishReason: toFinishReason(result), usage: toUsage(result) })
        } catch (error) {
          controller.enqueue({ type: 'error', error })
        }
        controller.close()
      }
    })
    return { stream }
  }

  private async generate(
    options: LanguageModelV3CallOptions,
    onEvent: (event: LlmGenerateEvent) => void,
    onStart?: (warnings: SharedV3Warning[]) => void
  ): Promise<{ result: LlmGenerateResult; warnings: SharedV3Warning[] }> {
    const warnings = unsupportedOptionWarnings(options)
    const input: LlmGenerateInput = {
      messages: toLlmMessages(options.prompt),
      // Qwen3.5 reasons for thousands of tokens on simple prompts; the reasoning toggle is not wired yet.
      thinking: false,
      maxOutputTokens: options.maxOutputTokens,
      sampling: definedOnly({
        temperature: options.temperature,
        topP: options.topP,
        topK: options.topK,
        presencePenalty: options.presencePenalty
      })
    }
    onStart?.(warnings)
    const result = await application
      .get('LlmInferenceService')
      .generate(this.modelId as LocalModelBundleId, input, { signal: options.abortSignal, onEvent })
    return { result, warnings }
  }
}

function toLlmMessages(prompt: LanguageModelV3CallOptions['prompt']): LlmChatMessage[] {
  return prompt.map((message): LlmChatMessage => {
    if (message.role === 'system') return { role: 'system', text: message.content }
    if (message.role === 'tool') throw new UnsupportedFunctionalityError({ functionality: 'tool results' })
    const texts: string[] = []
    for (const part of message.content) {
      if (part.type === 'text') texts.push(part.text)
      // Earlier reasoning is not replayed; the chat template drops it from history too.
      else if (part.type !== 'reasoning')
        throw new UnsupportedFunctionalityError({ functionality: `${part.type} parts` })
    }
    return { role: message.role, text: texts.join('\n') }
  })
}

/** Options the local runtime does not implement; the request runs without them. */
function unsupportedOptionWarnings(options: LanguageModelV3CallOptions): SharedV3Warning[] {
  const used = {
    tools: Boolean(options.tools?.length),
    stopSequences: Boolean(options.stopSequences?.length),
    frequencyPenalty: options.frequencyPenalty !== undefined,
    seed: options.seed !== undefined,
    responseFormat: options.responseFormat?.type === 'json'
  }
  return Object.entries(used)
    .filter(([, isUsed]) => isUsed)
    .map(([feature]): SharedV3Warning => ({ type: 'unsupported', feature }))
}

function definedOnly<T extends Record<string, number | undefined>>(values: T): Partial<Record<keyof T, number>> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<
    Record<keyof T, number>
  >
}

function toFinishReason(result: LlmGenerateResult): LanguageModelV3FinishReason {
  return { unified: result.finishReason, raw: undefined }
}

function toUsage({ usage }: LlmGenerateResult): LanguageModelV3Usage {
  return {
    inputTokens: { total: usage.inputTokens, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: usage.outputTokens, text: undefined, reasoning: undefined }
  }
}

export interface LocalLlmProviderSettings {
  /** In-process, no auth — accepted for type symmetry with other extensions. */
  apiKey?: string
  /** Unused (no HTTP); the shared config builder sets `fetch` on every provider's settings. */
  fetch?: FetchFunction
}

/** Chat-only `ProviderV3` for models installed through Local Models. */
// `_settings` types the extension's settings; see localEmbeddingProvider.
// oxlint-disable-next-line no-unused-vars
export function createLocalLlmProvider(_settings: LocalLlmProviderSettings = {}): ProviderV3 {
  const unsupported = (capability: string) => (): never => {
    throw new Error(`local-llm provider only supports chat models, not ${capability}`)
  }
  return {
    specificationVersion: 'v3',
    languageModel: (modelId) => new LocalLlmLanguageModel(modelId),
    embeddingModel: unsupported('embedding models'),
    imageModel: unsupported('image models')
  }
}
