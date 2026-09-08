import type { LanguageModelV3StreamPart, LanguageModelV3Usage } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

import { type AiPlugin, definePlugin } from '@cherrystudio/ai-core'
import {
  type AiUsageCaptureContext,
  aiUsageRecordService,
  type RecordAiInvocationInput
} from '@data/services/AiUsageRecordService'

import { extractProviderCostWithCurrency } from '../utils/billingCost'

export const BILLABLE_AI_OPERATIONS = ['streamText', 'generateText', 'embedMany', 'generateImage', 'rerank'] as const
export type BillableAiOperation = (typeof BILLABLE_AI_OPERATIONS)[number]

export const AI_USAGE_RECORD_OPERATION_COVERAGE = {
  streamText: { status: 'recorded', modality: 'language', capture: 'language-middleware' },
  generateText: { status: 'recorded', modality: 'language', capture: 'language-middleware' },
  embedMany: { status: 'recorded', modality: 'embedding', capture: 'ai-core-handler' },
  generateImage: { status: 'recorded', modality: 'image', capture: 'ai-core-handler' },
  rerank: { status: 'recorded', modality: 'rerank', capture: 'ai-core-handler' }
} as const

function usageToRecord(usage: LanguageModelV3Usage): NonNullable<RecordAiInvocationInput['usage']> {
  const inputTokens = usage.inputTokens.total
  const outputTokens = usage.outputTokens.total
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(inputTokens !== undefined || outputTokens !== undefined
      ? { totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0) }
      : {}),
    ...(usage.outputTokens.reasoning !== undefined ? { reasoningTokens: usage.outputTokens.reasoning } : {}),
    ...(usage.inputTokens.noCache !== undefined ? { noCacheTokens: usage.inputTokens.noCache } : {}),
    ...(usage.inputTokens.cacheRead !== undefined ? { cacheReadTokens: usage.inputTokens.cacheRead } : {}),
    ...(usage.inputTokens.cacheWrite !== undefined ? { cacheWriteTokens: usage.inputTokens.cacheWrite } : {})
  }
}

function semanticOutput(part: LanguageModelV3StreamPart): boolean {
  return (
    part.type === 'text-delta' ||
    part.type === 'reasoning-delta' ||
    part.type === 'tool-input-delta' ||
    part.type === 'tool-call' ||
    part.type === 'tool-result' ||
    part.type === 'file'
  )
}

function nonReasoningOutput(part: LanguageModelV3StreamPart): boolean {
  return semanticOutput(part) && part.type !== 'reasoning-delta'
}

function recordLanguageInvocation(
  context: AiUsageCaptureContext,
  requestId: string,
  usage: LanguageModelV3Usage,
  metrics: RecordAiInvocationInput['metrics'],
  completedAt: number
): void {
  const providerCost = extractProviderCostWithCurrency(usage.raw, context.reportedCostCurrency)
  aiUsageRecordService.recordInvocation({
    requestId,
    context,
    modality: 'language',
    usage: usageToRecord(usage),
    ...(providerCost ? { providerCost } : {}),
    metrics,
    completedAt
  })
}

export function createLanguageUsageMiddleware(context: AiUsageCaptureContext): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    wrapGenerate: async ({ doGenerate }) => {
      const requestId = `ai-sdk:${context.providerId}:${crypto.randomUUID()}`
      const startedAt = performance.now()
      const result = await doGenerate()
      recordLanguageInvocation(
        context,
        requestId,
        result.usage,
        { timeCompletionMs: Math.max(0, Math.round(performance.now() - startedAt)) },
        Date.now()
      )
      return result
    },
    wrapStream: async ({ doStream }) => {
      const requestId = `ai-sdk:${context.providerId}:${crypto.randomUUID()}`
      const startedAt = performance.now()
      const result = await doStream()
      let firstTokenAt: number | undefined
      let thinkingStartedAt: number | undefined
      let thinkingDurationMs: number | undefined
      let finished = false

      const stream = result.stream.pipeThrough(
        new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
          transform(part, controller) {
            const now = performance.now()
            if (semanticOutput(part) && firstTokenAt === undefined) firstTokenAt = now
            if (
              (part.type === 'reasoning-start' || part.type === 'reasoning-delta') &&
              thinkingStartedAt === undefined
            ) {
              thinkingStartedAt = now
            }
            if (
              thinkingStartedAt !== undefined &&
              thinkingDurationMs === undefined &&
              (nonReasoningOutput(part) || part.type === 'finish')
            ) {
              thinkingDurationMs = Math.max(0, Math.round(now - thinkingStartedAt))
            }

            if (part.type === 'finish' && !finished) {
              finished = true
              recordLanguageInvocation(
                context,
                requestId,
                part.usage,
                {
                  ...(firstTokenAt !== undefined
                    ? { timeFirstTokenMs: Math.max(0, Math.round(firstTokenAt - startedAt)) }
                    : {}),
                  timeCompletionMs: Math.max(0, Math.round(now - startedAt)),
                  ...(thinkingDurationMs !== undefined ? { timeThinkingMs: thinkingDurationMs } : {})
                },
                Date.now()
              )
            }

            controller.enqueue(part)
          }
        })
      )

      return { ...result, stream }
    }
  }
}

export function createAiUsagePlugin(context: AiUsageCaptureContext): AiPlugin {
  const middleware = createLanguageUsageMiddleware(context)
  return definePlugin({
    name: 'ai-usage-capture',
    configureContext(requestContext) {
      requestContext.middlewares = [...(requestContext.middlewares ?? []), middleware]
    }
  })
}
