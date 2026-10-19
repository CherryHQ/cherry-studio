import {
  APICallError,
  type LanguageModelV3,
  type LanguageModelV3CallOptions,
  type LanguageModelV3Content,
  type LanguageModelV3FinishReason,
  type LanguageModelV3GenerateResult,
  type LanguageModelV3StreamPart,
  type LanguageModelV3StreamResult,
  type LanguageModelV3ToolResultOutput,
  type LanguageModelV3Usage,
  type ProviderV3,
  type SharedV3Warning,
  UnsupportedFunctionalityError
} from '@ai-sdk/provider'
import { type FetchFunction, generateId } from '@ai-sdk/provider-utils'

import { application } from '@application'
import {
  LLM_CONTEXT_OVERFLOW,
  type LlmChatMessage,
  type LlmGenerateEvent,
  type LlmGenerateInput,
  type LlmGenerateResult,
  type LlmTool,
  type LlmToolCall
} from '@main/ai/localModel'
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
    content.push(...toToolCallParts(result.toolCalls))
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
          for (const part of toToolCallParts(result.toolCalls)) controller.enqueue(part)
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
      tools: options.toolChoice?.type === 'none' ? undefined : toLlmTools(options.tools, warnings),
      thinking: isThinkingRequested(options),
      maxOutputTokens: options.maxOutputTokens,
      sampling: definedOnly({
        temperature: options.temperature,
        topP: options.topP,
        topK: options.topK,
        presencePenalty: options.presencePenalty
      })
    }
    onStart?.(warnings)
    try {
      const result = await application
        .get('LlmInferenceService')
        .generate(this.modelId as LocalModelBundleId, input, { signal: options.abortSignal, onEvent })
      return { result, warnings }
    } catch (error) {
      if ((error as { code?: unknown }).code !== LLM_CONTEXT_OVERFLOW) throw error
      // A 400 the same prompt can never pass, so retry layers and the agent gateway give up at once.
      throw new APICallError({
        message: (error as Error).message,
        url: LOCAL_LLM_PROVIDER_ID,
        requestBodyValues: {},
        statusCode: 400,
        isRetryable: false,
        cause: error
      })
    }
  }
}

function toLlmMessages(prompt: LanguageModelV3CallOptions['prompt']): LlmChatMessage[] {
  const messages: LlmChatMessage[] = []
  // Tool results arrive in a later message; they attach to the call that requested them.
  const calls = new Map<string, LlmToolCall & { result: unknown }>()
  for (const message of prompt) {
    if (message.role === 'system') {
      messages.push({ role: 'system', text: message.content })
    } else if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type !== 'tool-result') continue
        const call = calls.get(part.toolCallId)
        if (!call) throw new UnsupportedFunctionalityError({ functionality: 'tool results without their call' })
        call.result = toToolResult(part.output)
      }
    } else {
      const texts: string[] = []
      const toolCalls: Array<LlmToolCall & { result: unknown }> = []
      for (const part of message.content) {
        if (part.type === 'text') texts.push(part.text)
        else if (part.type === 'tool-call' && message.role === 'assistant') {
          const call = { name: part.toolName, params: part.input, result: null }
          calls.set(part.toolCallId, call)
          toolCalls.push(call)
        }
        // Earlier reasoning is not replayed; the chat template drops it from history too.
        else if (part.type !== 'reasoning')
          throw new UnsupportedFunctionalityError({ functionality: `${part.type} parts` })
      }
      messages.push(
        message.role === 'assistant'
          ? { role: 'assistant', text: texts.join('\n'), ...(toolCalls.length > 0 && { toolCalls }) }
          : { role: 'user', text: texts.join('\n') }
      )
    }
  }
  return messages
}

function toToolResult(output: LanguageModelV3ToolResultOutput): unknown {
  switch (output.type) {
    case 'text':
    case 'json':
      return output.value
    case 'error-text':
    case 'error-json':
      return { error: output.value }
    case 'execution-denied':
      return { error: `The user denied this tool call${output.reason ? `: ${output.reason}` : ''}` }
    case 'content':
      return output.value.flatMap((item) => (item.type === 'text' ? [item.text] : [])).join('\n')
  }
}

function toLlmTools(tools: LanguageModelV3CallOptions['tools'], warnings: SharedV3Warning[]): LlmTool[] | undefined {
  const functionTools: LlmTool[] = []
  for (const tool of tools ?? []) {
    if (tool.type === 'function') {
      functionTools.push({ name: tool.name, description: tool.description, parameters: tool.inputSchema })
    } else warnings.push({ type: 'unsupported', feature: `provider tool ${tool.name}` })
  }
  return functionTools.length > 0 ? functionTools : undefined
}

function toToolCallParts(toolCalls: LlmToolCall[] | undefined) {
  return (toolCalls ?? []).map((call) => ({
    type: 'tool-call' as const,
    toolCallId: generateId(),
    toolName: call.name,
    input: JSON.stringify(call.params ?? {})
  }))
}

/** The reasoning toggle arrives as `reasoningEffort`; with no selection the model keeps its default, off. */
function isThinkingRequested(options: LanguageModelV3CallOptions): boolean {
  const effort = options.providerOptions?.[LOCAL_LLM_PROVIDER_ID]?.reasoningEffort
  return effort !== undefined && effort !== 'none'
}

/** Options the local runtime does not implement; the request runs without them. */
function unsupportedOptionWarnings(options: LanguageModelV3CallOptions): SharedV3Warning[] {
  const used = {
    toolChoice: options.toolChoice?.type === 'required' || options.toolChoice?.type === 'tool',
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
