import { randomUUID } from 'node:crypto'

import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  calculateCost,
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  type JsonObject,
  type Model,
  type SimpleStreamOptions,
  type StopReason,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
  type TranscriptContext,
  type Usage
} from '@earendil-works/pi-ai'
import type { ProviderConfig, ProviderModelConfig } from '@earendil-works/pi-coding-agent'
import type { FinishReason, LanguageModelUsage, TextStreamPart, ToolSet } from 'ai'

import { toModelMessages, toToolSet } from './modelMessages'
import type { ModelCallInfo, ModelCallPort, ModelCallRequest, ModelCallSideChannel } from './ports'
import { encodeProviderMetadata } from './providerMetadata'

/** Pi `api` id of models served through a {@link ModelCallPort}. */
export const AI_SDK_API = 'ai-sdk'

/** What Pi needs to know about a model: limits drive context accounting and compaction, cost Pi's own stats. */
export type AiSdkModelSpec = Pick<
  Extract<ProviderModelConfig, { reasoning: boolean }>,
  'id' | 'name' | 'contextWindow' | 'maxTokens' | 'reasoning' | 'input' | 'cost'
>

export interface AiSdkProviderOptions<TRequestOptions = undefined> {
  port: ModelCallPort<TRequestOptions>
  /** Forwarded on every request; the host decides reasoning here, not through Pi's thinking level. */
  requestOptions: TRequestOptions
  models: AiSdkModelSpec[]
  sideChannel?: ModelCallSideChannel
}

type FinishStepPart = Extract<TextStreamPart<ToolSet>, { type: 'finish-step' }>

const zeroCost = (): Usage['cost'] => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })

/**
 * Usage reported to Pi feeds its context accounting and compaction only. The host's AI SDK call
 * has already accounted the same tokens, so usage read back from Pi must not be billed again.
 */
function toPiUsage(usage: LanguageModelUsage, model: Model<Api>): Usage {
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0
  const input = usage.inputTokenDetails?.noCacheTokens ?? Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite)
  const output = usage.outputTokens ?? 0
  const result: Usage = {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning: usage.outputTokenDetails?.reasoningTokens,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: zeroCost()
  }
  calculateCost(model, result)
  return result
}

// Kept verbatim: Pi detects context overflow from the provider's own error text.
function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : JSON.stringify(error)
}

function toPiStopReason(reason: FinishReason): StopReason {
  switch (reason) {
    case 'length':
      return 'length'
    case 'tool-calls':
      return 'toolUse'
    case 'content-filter':
    case 'error':
      return 'error'
    default:
      return 'stop'
  }
}

/**
 * A Pi provider whose every model request is one call to the host's {@link ModelCallPort}.
 * Pi's own retry must stay disabled: retries belong to the host's AI SDK layer.
 */
export function createAiSdkProvider<TRequestOptions>(options: AiSdkProviderOptions<TRequestOptions>): ProviderConfig {
  return {
    api: AI_SDK_API,
    // Pi requires both when models are defined; requests go through the port, never to this URL.
    baseUrl: 'https://ai-sdk-port.invalid',
    apiKey: 'unused',
    models: options.models.map((model) => ({ ...model, api: AI_SDK_API })),
    streamSimple: (model, context, streamOptions) => streamModelCall(options, model, context, streamOptions)
  }
}

function streamModelCall<TRequestOptions>(
  provider: AiSdkProviderOptions<TRequestOptions>,
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream()
  const output: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: zeroCost() },
    stopReason: 'pending',
    timestamp: Date.now()
  }
  const call: ModelCallInfo = {
    requestId: randomUUID(),
    sessionId: options?.sessionId,
    model: { provider: model.provider, id: model.id }
  }
  const signal = options?.signal
  let reader: ReadableStreamDefaultReader<TextStreamPart<ToolSet>> | undefined
  // A port stream that ignores the signal would otherwise hold the turn open until it ends.
  const cancelRead = () => void reader?.cancel().catch(() => {})

  const run = async () => {
    const texts = new Map<string, TextContent>()
    const thinkings = new Map<string, ThinkingContent>()
    const toolCalls = new Map<string, ToolCall>()
    const indexOf = (block: TextContent | ThinkingContent | ToolCall) => output.content.indexOf(block)
    let finish: FinishStepPart | undefined
    signal?.addEventListener('abort', cancelRead, { once: true })
    try {
      let request: ModelCallRequest<TRequestOptions> = {
        ...call,
        system: getCurrentSystemPrompt(context.messages) || undefined,
        messages: toModelMessages(context, model),
        tools: toToolSet(context),
        toolChoice: options?.toolChoice,
        maxOutputTokens: options?.maxTokens,
        temperature: options?.temperature,
        abortSignal: signal,
        options: provider.requestOptions
      }
      // Pi contract: extensions see the request (`before_provider_request`) and may replace it.
      const replaced = await options?.onPayload?.(request, model)
      if (replaced !== undefined) request = replaced as ModelCallRequest<TRequestOptions>

      const result = await provider.port.streamText(request)
      reader = result.fullStream.getReader()
      if (signal?.aborted) cancelRead()
      stream.push({ type: 'start', partial: output })

      for (;;) {
        const { done, value: part } = await reader.read()
        if (done) break
        await options?.onProviderStreamEvent?.(part, model)
        switch (part.type) {
          case 'text-start': {
            const block: TextContent = { type: 'text', text: '' }
            output.content.push(block)
            texts.set(part.id, block)
            stream.push({ type: 'text_start', contentIndex: indexOf(block), partial: output })
            break
          }
          case 'text-delta': {
            const block = texts.get(part.id)!
            block.text += part.text
            stream.push({ type: 'text_delta', contentIndex: indexOf(block), delta: part.text, partial: output })
            break
          }
          case 'text-end': {
            const block = texts.get(part.id)!
            block.textSignature = encodeProviderMetadata(part.providerMetadata)
            stream.push({ type: 'text_end', contentIndex: indexOf(block), content: block.text, partial: output })
            break
          }
          case 'reasoning-start': {
            const block: ThinkingContent = { type: 'thinking', thinking: '' }
            output.content.push(block)
            thinkings.set(part.id, block)
            stream.push({ type: 'thinking_start', contentIndex: indexOf(block), partial: output })
            break
          }
          case 'reasoning-delta': {
            const block = thinkings.get(part.id)!
            block.thinking += part.text
            stream.push({ type: 'thinking_delta', contentIndex: indexOf(block), delta: part.text, partial: output })
            break
          }
          case 'reasoning-end': {
            const block = thinkings.get(part.id)!
            block.thinkingSignature = encodeProviderMetadata(part.providerMetadata)
            stream.push({
              type: 'thinking_end',
              contentIndex: indexOf(block),
              content: block.thinking,
              partial: output
            })
            break
          }
          case 'tool-input-start': {
            if (part.providerExecuted) break
            const block: ToolCall = { type: 'toolCall', id: part.id, name: part.toolName, arguments: {} }
            output.content.push(block)
            toolCalls.set(part.id, block)
            stream.push({ type: 'toolcall_start', contentIndex: indexOf(block), partial: output })
            break
          }
          case 'tool-input-delta': {
            const block = toolCalls.get(part.id)
            if (block)
              stream.push({ type: 'toolcall_delta', contentIndex: indexOf(block), delta: part.delta, partial: output })
            break
          }
          case 'tool-call': {
            if (part.providerExecuted) {
              provider.sideChannel?.onUnmappedPart?.(part, call)
              break
            }
            let block = toolCalls.get(part.toolCallId)
            if (!block) {
              block = { type: 'toolCall', id: part.toolCallId, name: part.toolName, arguments: {} }
              output.content.push(block)
              toolCalls.set(part.toolCallId, block)
              stream.push({ type: 'toolcall_start', contentIndex: indexOf(block), partial: output })
            }
            block.arguments = (part.input ?? {}) as JsonObject
            block.thoughtSignature = encodeProviderMetadata(part.providerMetadata)
            stream.push({ type: 'toolcall_end', contentIndex: indexOf(block), toolCall: block, partial: output })
            break
          }
          case 'source':
          case 'file':
          case 'tool-result':
          case 'tool-error':
            provider.sideChannel?.onUnmappedPart?.(part, call)
            break
          case 'finish-step':
            finish = part
            output.usage = toPiUsage(part.usage, model)
            output.stopReason = toPiStopReason(part.finishReason)
            output.rawStopReason = part.rawFinishReason
            output.responseId = part.response.id
            output.responseModel = part.response.modelId
            break
          case 'error':
            throw part.error
          case 'abort':
            throw new Error('Model call was aborted')
          default:
            break
        }
      }
      if (signal?.aborted) throw new Error('Model call was aborted')
      if (!finish) throw new Error('Model stream ended without a finish')
      if (output.stopReason === 'error') throw new Error(`Model finished with reason: ${finish.finishReason}`)
      stream.push({ type: 'done', reason: output.stopReason as 'stop' | 'length' | 'toolUse', message: output })
      stream.end()
    } catch (error) {
      const aborted = signal?.aborted === true
      output.stopReason = aborted ? 'aborted' : 'error'
      output.errorMessage = errorMessageOf(error)
      try {
        if (!aborted) provider.sideChannel?.onError?.(error, call)
      } finally {
        stream.push({ type: 'error', reason: output.stopReason, error: output })
        stream.end()
      }
    } finally {
      signal?.removeEventListener('abort', cancelRead)
      cancelRead()
    }
  }
  void run()
  return stream
}
