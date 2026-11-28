import { AsyncLocalStorage } from 'node:async_hooks'

import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { APICallError } from 'ai'
import { isErrorAttempt, type LanguageModel, type Retryable } from 'ai-retry'

import { definePlugin } from '@cherrystudio/ai-core'

import { getTerminalModelError } from '../../../utils/retryError'

const useCompletionField = Symbol('useCompletionField')
const omitStreamOptions = Symbol('omitStreamOptions')
const STREAM_OPTIONS_REJECTIONS = [
  /\b(?:unknown|unrecognized|unsupported|invalid) (?:request )?(?:parameter|field|argument)(?: supplied)?[:\s]+(?:stream_options(?:\.include_usage)?|include_usage)\b/i,
  /\b(?:stream_options(?:\.include_usage)?|include_usage) (?:is )?(?:unsupported|not supported|not allowed)\b/i
]
type ChatProviderOptions = ProviderOptions & { [useCompletionField]?: true; [omitStreamOptions]?: true }

interface ChatRequestAttempt {
  useCompletion?: true
  omitUsage?: true
  sentLegacy?: number
  sentCompletion?: number
  sentStreamOptions?: boolean
}

const chatRequestAttempt = new AsyncLocalStorage<ChatRequestAttempt>()
const failedChatRequests = new WeakMap<APICallError, ChatRequestAttempt>()

function positiveBudget(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function applyChatRequestRepair(body: Record<string, unknown>, streamUsageEnabled = true): void {
  const attempt = chatRequestAttempt.getStore()
  if (!streamUsageEnabled || attempt?.omitUsage) delete body.stream_options
  if (!attempt) return
  if (attempt.useCompletion && positiveBudget(body.max_tokens)) {
    body.max_completion_tokens ??= body.max_tokens
    delete body.max_tokens
  }
  attempt.sentLegacy = positiveBudget(body.max_tokens) ? body.max_tokens : undefined
  attempt.sentCompletion = positiveBudget(body.max_completion_tokens) ? body.max_completion_tokens : undefined
  attempt.sentStreamOptions = Object.hasOwn(body, 'stream_options')
}

async function observeChatRequest<T>(
  options: ProviderOptions | undefined,
  run: (providerOptions?: ProviderOptions) => PromiseLike<T>
): Promise<T> {
  const {
    [useCompletionField]: useCompletion,
    [omitStreamOptions]: omitUsage,
    ...providerOptions
  }: ChatProviderOptions = options ?? {}
  const attempt: ChatRequestAttempt = { useCompletion, omitUsage }
  try {
    return await chatRequestAttempt.run(attempt, () => run(useCompletion || omitUsage ? providerOptions : undefined))
  } catch (error) {
    if (APICallError.isInstance(error) && error.statusCode === 400) failedChatRequests.set(error, attempt)
    throw error
  }
}

export const observeChatRequestPlugin = definePlugin({
  name: 'observe-chat-request',
  configureContext: (context) => {
    context.middlewares ??= []
    context.middlewares.push({
      specificationVersion: 'v3',
      wrapGenerate: ({ params, model, doGenerate }) =>
        observeChatRequest(params.providerOptions, (providerOptions) =>
          providerOptions ? model.doGenerate({ ...params, providerOptions }) : doGenerate()
        ),
      wrapStream: ({ params, model, doStream }) =>
        observeChatRequest(params.providerOptions, (providerOptions) =>
          providerOptions ? model.doStream({ ...params, providerOptions }) : doStream()
        )
    })
  }
})

export function chatTokenFieldRetry(maxRetries: number): Retryable<LanguageModel> {
  return ({ current }) => {
    if (!isErrorAttempt(current) || current.options.abortSignal?.aborted) return
    const error = getTerminalModelError(current.error)
    if (!APICallError.isInstance(error) || error.statusCode !== 400) return
    const attempt = failedChatRequests.get(error)
    if (!attempt?.sentLegacy || attempt.useCompletion) return

    const message = error.message.toLowerCase().replace(/['"`]/g, '')
    const requiresCompletion = /\bmax_tokens\b/.test(message) && /\buse max_completion_tokens instead\b/.test(message)
    const rejectsBoth = /\bmax_tokens and max_completion_tokens at the same time is not supported\b/.test(message)
    if (!requiresCompletion && !(rejectsBoth && attempt.sentCompletion !== undefined)) return

    const providerOptions: ChatProviderOptions = { ...current.options.providerOptions, [useCompletionField]: true }
    return {
      model: current.model,
      options: { ...current.options, providerOptions },
      maxAttempts: maxRetries + 1
    }
  }
}

export function chatStreamOptionsRetry(maxRetries: number): Retryable<LanguageModel> {
  return ({ current }) => {
    if (!isErrorAttempt(current) || current.options.abortSignal?.aborted) return
    const error = getTerminalModelError(current.error)
    if (!APICallError.isInstance(error) || !failedChatRequests.get(error)?.sentStreamOptions) return

    const description = error.data == null ? error.responseBody?.slice(0, 16 * 1024) || error.message : error.message
    const message = description.replace(/['"`]/g, '')
    if (!STREAM_OPTIONS_REJECTIONS.some((pattern) => pattern.test(message))) return

    const providerOptions: ChatProviderOptions = { ...current.options.providerOptions, [omitStreamOptions]: true }
    return {
      model: current.model,
      options: { ...current.options, providerOptions },
      maxAttempts: maxRetries + 1
    }
  }
}
