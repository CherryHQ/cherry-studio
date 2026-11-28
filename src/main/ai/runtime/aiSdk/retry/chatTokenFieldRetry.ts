import { AsyncLocalStorage } from 'node:async_hooks'

import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { APICallError } from 'ai'
import { isErrorAttempt, type LanguageModel, type Retryable } from 'ai-retry'

import { definePlugin } from '@cherrystudio/ai-core'

import { getTerminalModelError } from '../../../utils/retryError'

const useCompletionField = Symbol('useCompletionField')
type ChatProviderOptions = ProviderOptions & { [useCompletionField]?: true }

interface ChatBudgetAttempt {
  useCompletion?: boolean
  sentLegacy?: number
  sentCompletion?: number
}

const chatBudgetAttempt = new AsyncLocalStorage<ChatBudgetAttempt>()
const failedChatBudgets = new WeakMap<APICallError, ChatBudgetAttempt>()

function positiveBudget(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function applyChatTokenFieldRetry(body: Record<string, unknown>): void {
  const attempt = chatBudgetAttempt.getStore()
  if (!attempt) return
  if (attempt.useCompletion && positiveBudget(body.max_tokens)) {
    body.max_completion_tokens ??= body.max_tokens
    delete body.max_tokens
  }
  attempt.sentLegacy = positiveBudget(body.max_tokens) ? body.max_tokens : undefined
  attempt.sentCompletion = positiveBudget(body.max_completion_tokens) ? body.max_completion_tokens : undefined
}

async function observeChatBudget<T>(useCompletion: boolean | undefined, run: () => PromiseLike<T>): Promise<T> {
  const attempt: ChatBudgetAttempt = { useCompletion }
  try {
    return await chatBudgetAttempt.run(attempt, run)
  } catch (error) {
    if (APICallError.isInstance(error) && error.statusCode === 400) failedChatBudgets.set(error, attempt)
    throw error
  }
}

export const observeChatBudgetPlugin = definePlugin({
  name: 'observe-chat-budget',
  configureContext: (context) => {
    context.middlewares ??= []
    context.middlewares.push({
      specificationVersion: 'v3',
      wrapGenerate: ({ params, model, doGenerate }) => {
        const { [useCompletionField]: useCompletion, ...providerOptions }: ChatProviderOptions =
          params.providerOptions ?? {}
        return observeChatBudget(useCompletion, () =>
          useCompletion ? model.doGenerate({ ...params, providerOptions }) : doGenerate()
        )
      },
      wrapStream: ({ params, model, doStream }) => {
        const { [useCompletionField]: useCompletion, ...providerOptions }: ChatProviderOptions =
          params.providerOptions ?? {}
        return observeChatBudget(useCompletion, () =>
          useCompletion ? model.doStream({ ...params, providerOptions }) : doStream()
        )
      }
    })
  }
})

export function chatTokenFieldRetry(maxRetries: number): Retryable<LanguageModel> {
  return ({ current }) => {
    if (!isErrorAttempt(current) || current.options.abortSignal?.aborted) return
    const error = getTerminalModelError(current.error)
    if (!APICallError.isInstance(error) || error.statusCode !== 400) return
    const attempt = failedChatBudgets.get(error)
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
