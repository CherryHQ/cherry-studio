import type { LanguageModelV3StreamPart, LanguageModelV3Usage } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

import { type AiPlugin, definePlugin } from '@cherrystudio/ai-core'
import {
  type AiUsageCaptureContext,
  aiUsageRecordService,
  type RecordAiInvocationInput
} from '@data/services/AiUsageRecordService'

import { extractProviderCostWithCurrency } from '../utils/billingCost'
import { ensureNestedV3Usage, recordTotalTokens } from '../utils/usageNormalize'

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
  const normalized = ensureNestedV3Usage(usage)
  const inputTokens = normalized.inputTokens.total
  const outputTokens = normalized.outputTokens.total
  const totalTokens = recordTotalTokens(usage, inputTokens, outputTokens)
  const record: NonNullable<RecordAiInvocationInput['usage']> = {}
  if (inputTokens !== undefined) record.inputTokens = inputTokens
  if (outputTokens !== undefined) record.outputTokens = outputTokens
  if (totalTokens !== undefined) record.totalTokens = totalTokens
  if (normalized.outputTokens.reasoning !== undefined) record.reasoningTokens = normalized.outputTokens.reasoning
  if (normalized.inputTokens.noCache !== undefined) record.noCacheTokens = normalized.inputTokens.noCache
  if (normalized.inputTokens.cacheRead !== undefined) record.cacheReadTokens = normalized.inputTokens.cacheRead
  if (normalized.inputTokens.cacheWrite !== undefined) record.cacheWriteTokens = normalized.inputTokens.cacheWrite
  return record
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
  completedAt: number,
  record: (input: RecordAiInvocationInput) => void
): void {
  const providerCost = extractProviderCostWithCurrency(usage.raw, context.reportedCostCurrency)
  const input: Omit<RecordAiInvocationInput, 'metrics' | 'completedAt'> = {
    requestId,
    context,
    modality: 'language',
    usage: usageToRecord(usage)
  }
  if (providerCost) input.providerCost = providerCost
  record({ ...input, metrics, completedAt })
}

export type AiUsageCaptureSource = AiUsageCaptureContext | (() => AiUsageCaptureContext)

export function createLanguageUsageMiddleware(
  source: AiUsageCaptureSource,
  record: (input: RecordAiInvocationInput) => void = (input) => aiUsageRecordService.recordInvocation(input)
): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    wrapGenerate: async ({ doGenerate }) => {
      const context = typeof source === 'function' ? source() : source
      const requestId = `ai-sdk:${context.providerId}:${crypto.randomUUID()}`
      const startedAt = performance.now()
      const result = await doGenerate()
      recordLanguageInvocation(
        context,
        requestId,
        result.usage,
        { timeCompletionMs: Math.max(0, Math.round(performance.now() - startedAt)) },
        Date.now(),
        record
      )
      return result
    },
    wrapStream: async ({ doStream }) => {
      const context = typeof source === 'function' ? source() : source
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

            // Each provider call emits one V3 `finish` with usage; tool loops are separate calls.
            if (part.type === 'finish' && !finished) {
              finished = true
              const usage = part.usage
              const metrics: NonNullable<RecordAiInvocationInput['metrics']> = {}
              if (firstTokenAt !== undefined)
                metrics.timeFirstTokenMs = Math.max(0, Math.round(firstTokenAt - startedAt))
              metrics.timeCompletionMs = Math.max(0, Math.round(now - startedAt))
              if (thinkingDurationMs !== undefined) metrics.timeThinkingMs = thinkingDurationMs
              recordLanguageInvocation(context, requestId, usage, metrics, Date.now(), record)
            }

            controller.enqueue(part)
          }
        })
      )

      return { ...result, stream }
    }
  }
}

export function createAiUsagePlugin(
  context: AiUsageCaptureSource,
  record?: (input: RecordAiInvocationInput) => void
): AiPlugin {
  const middleware = createLanguageUsageMiddleware(context, record)
  return definePlugin({
    name: 'ai-usage-capture',
    configureContext(requestContext) {
      requestContext.middlewares = [...(requestContext.middlewares ?? []), middleware]
    }
  })
}
