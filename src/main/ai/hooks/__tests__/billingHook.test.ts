import type { LanguageModelV3StreamPart, LanguageModelV3Usage } from '@ai-sdk/provider'
import { gatewayUsageNormalizeFeature } from '@main/ai/runtime/aiSdk/params/features/gatewayUsageNormalize'
import type { LanguageModelMiddleware } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const recordInvocation = vi.fn()

vi.mock('@main/data/services/AiUsageRecordService', () => ({
  aiUsageRecordService: { recordInvocation }
}))

const { AI_USAGE_RECORD_OPERATION_COVERAGE, BILLABLE_AI_OPERATIONS, createLanguageUsageMiddleware } = await import(
  '../billingHook'
)

const context = {
  providerId: 'provider-1',
  providerName: 'Provider',
  modelId: 'model-1',
  modelName: 'Model',
  pricingSnapshot: null,
  trustProviderReportedCost: false,
  reportedCostCurrency: null,
  credentialReceipt: { attribution: 'unknown' as const },
  source: null,
  messageRef: { kind: 'chat' as const, id: 'message-1' }
}

const usage: LanguageModelV3Usage = {
  inputTokens: { total: 4, noCache: 4, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
  raw: undefined
}

async function readAll(stream: ReadableStream<LanguageModelV3StreamPart>): Promise<LanguageModelV3StreamPart[]> {
  const result: LanguageModelV3StreamPart[] = []
  for await (const part of stream) result.push(part)
  return result
}

function streamOf(parts: readonly LanguageModelV3StreamPart[]): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    }
  })
}

async function getGatewayUsageNormalizeMiddleware(): Promise<LanguageModelMiddleware> {
  const [plugin] = gatewayUsageNormalizeFeature.contributeModelAdapters!({} as never)
  if (!plugin) throw new Error('gateway usage plugin was not contributed')
  const requestContext = { middlewares: [] as LanguageModelMiddleware[] }
  await plugin.configureContext!(requestContext as never)
  const middleware = requestContext.middlewares[0]
  if (!middleware) throw new Error('gateway usage middleware was not registered')
  return middleware
}

describe('AI usage capture coverage', () => {
  it('assigns one capture owner to all five billable operations', () => {
    expect(Object.keys(AI_USAGE_RECORD_OPERATION_COVERAGE)).toEqual(BILLABLE_AI_OPERATIONS)
    expect(AI_USAGE_RECORD_OPERATION_COVERAGE).toEqual({
      streamText: { status: 'recorded', modality: 'language', capture: 'language-middleware' },
      generateText: { status: 'recorded', modality: 'language', capture: 'language-middleware' },
      embedMany: { status: 'recorded', modality: 'embedding', capture: 'ai-core-handler' },
      generateImage: { status: 'recorded', modality: 'image', capture: 'ai-core-handler' },
      rerank: { status: 'recorded', modality: 'rerank', capture: 'ai-core-handler' }
    })
  })
})

describe('createLanguageUsageMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
  })

  it('records generate completion without inventing TTFT', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(35)
    const middleware = createLanguageUsageMiddleware(context)
    const result = { usage, content: [], finishReason: { unified: 'stop', raw: 'stop' }, warnings: [] }

    await middleware.wrapGenerate!({ doGenerate: async () => result } as never)

    expect(recordInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'ai-sdk:provider-1:00000000-0000-4000-8000-000000000001',
        context,
        usage: expect.objectContaining({ inputTokens: 4, outputTokens: 2, totalTokens: 6 }),
        metrics: { timeCompletionMs: 25 }
      })
    )
    expect(recordInvocation.mock.calls[0][0].metrics.timeFirstTokenMs).toBeUndefined()
    now.mockRestore()
  })

  it('attaches amount-only provider cost with the frozen registry currency', async () => {
    const middleware = createLanguageUsageMiddleware({
      ...context,
      trustProviderReportedCost: true,
      reportedCostCurrency: 'USD'
    })

    await middleware.wrapGenerate!({
      doGenerate: async () => ({
        usage: { ...usage, raw: { cost: 0.0123 } },
        content: [],
        finishReason: { unified: 'stop', raw: 'stop' },
        warnings: []
      })
    } as never)

    expect(recordInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        providerCost: { amount: 0.0123, currency: 'USD' }
      })
    )
  })

  it('forwards stream chunks unchanged and records per-call TTFT, completion, and thinking', async () => {
    const parts: LanguageModelV3StreamPart[] = [
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', delta: 'think' },
      { type: 'text-delta', id: 't1', delta: 'answer' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }
    ]
    const now = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(110)
      .mockReturnValueOnce(120)
      .mockReturnValueOnce(140)
      .mockReturnValueOnce(180)
    const middleware = createLanguageUsageMiddleware(context)
    const wrapped = await middleware.wrapStream!({
      doStream: async () => ({ stream: streamOf(parts) })
    } as never)

    expect(await readAll(wrapped.stream)).toEqual(parts)
    expect(recordInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        metrics: { timeFirstTokenMs: 20, timeCompletionMs: 80, timeThinkingMs: 30 }
      })
    )
    now.mockRestore()
  })

  it('records each streaming step as an independent provider invocation', async () => {
    vi.mocked(crypto.randomUUID)
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
    const now = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(40)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(130)
      .mockReturnValueOnce(170)
    const middleware = createLanguageUsageMiddleware(context)
    const parts: LanguageModelV3StreamPart[] = [
      { type: 'text-delta', id: 't1', delta: 'answer' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }
    ]

    const first = await middleware.wrapStream!({ doStream: async () => ({ stream: streamOf(parts) }) } as never)
    await readAll(first.stream)
    const second = await middleware.wrapStream!({ doStream: async () => ({ stream: streamOf(parts) }) } as never)
    await readAll(second.stream)

    expect(
      recordInvocation.mock.calls.map(([input]) => ({
        requestId: input.requestId,
        metrics: input.metrics
      }))
    ).toEqual([
      {
        requestId: 'ai-sdk:provider-1:00000000-0000-4000-8000-000000000001',
        metrics: { timeFirstTokenMs: 10, timeCompletionMs: 30 }
      },
      {
        requestId: 'ai-sdk:provider-1:00000000-0000-4000-8000-000000000002',
        metrics: { timeFirstTokenMs: 30, timeCompletionMs: 70 }
      }
    ])
    now.mockRestore()
  })

  it('does not create a successful record when a partial stream errors before finish', async () => {
    const middleware = createLanguageUsageMiddleware(context)
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({ type: 'text-delta', id: 't1', delta: 'partial' })
        controller.error(new Error('network'))
      }
    })
    const wrapped = await middleware.wrapStream!({ doStream: async () => ({ stream }) } as never)

    await expect(readAll(wrapped.stream)).rejects.toThrow('network')
    expect(recordInvocation).not.toHaveBeenCalled()
  })

  it('records normalized gateway usage instead of the provider flat shape', async () => {
    const capture = createLanguageUsageMiddleware(context)
    const gatewayUsageNormalizeMiddleware = await getGatewayUsageNormalizeMiddleware()
    const rawFinish = {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cachedInputTokens: 40
      }
    } as unknown as LanguageModelV3StreamPart

    const wrapped = await capture.wrapStream!({
      doStream: () =>
        gatewayUsageNormalizeMiddleware.wrapStream!({
          doStream: async () => ({ stream: streamOf([rawFinish]) })
        } as never)
    } as never)
    await readAll(wrapped.stream)

    expect(recordInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          noCacheTokens: 60,
          cacheReadTokens: 40
        }
      })
    )
  })
})
