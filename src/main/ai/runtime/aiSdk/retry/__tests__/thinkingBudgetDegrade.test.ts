import type { LanguageModelV3 } from '@ai-sdk/provider'
import { APICallError } from 'ai'
import type { LanguageModel, RetryContext } from 'ai-retry'
import { describe, expect, it, vi } from 'vitest'

import { thinkingBudgetDegradeRetryable } from '../thinkingBudgetDegrade'

const BAILIAN_81920 =
  'API Error: 400 <400> InternalError.Algo.InvalidParameter: The thinking_budget parameter must be a positive integer and not greater than 81920'
const BAILIAN_ZERO =
  '<400> InternalError.Algo.InvalidParameter: The thinking_budget parameter must be a positive integer and not greater than 0'

function apiError(message: string, statusCode = 400): APICallError {
  return new APICallError({
    message,
    url: 'https://maas.qianwenaiapi.com/compatible-mode/v1/',
    requestBodyValues: {},
    statusCode
  })
}

const fakeModel = {
  specificationVersion: 'v3',
  provider: 'test',
  modelId: 'qwen3.5-plus',
  supportedUrls: {},
  doGenerate: vi.fn(),
  doStream: vi.fn()
} as unknown as LanguageModelV3

function errorContext(
  error: unknown,
  providerOptions: unknown,
  attempts: RetryContext<LanguageModel>['attempts'] = []
): RetryContext<LanguageModel> {
  return {
    current: {
      type: 'error',
      error,
      model: fakeModel as never,
      options: { prompt: [], providerOptions: providerOptions as never }
    },
    attempts
  } as unknown as RetryContext<LanguageModel>
}

function priorErrorAttempt(): RetryContext<LanguageModel>['attempts'][number] {
  return {
    type: 'error',
    error: apiError(BAILIAN_81920),
    model: fakeModel as never,
    options: { prompt: [], providerOptions: {} as never }
  } as unknown as RetryContext<LanguageModel>['attempts'][number]
}

describe('thinkingBudgetDegradeRetryable', () => {
  it('clamps an over-ceiling budget to the reported ceiling and keeps thinking on', async () => {
    const retryable = thinkingBudgetDegradeRetryable()
    const result = await retryable(
      errorContext(apiError(BAILIAN_81920), { dashscope: { enable_thinking: true, thinking_budget: 100_000 } })
    )

    expect(result).toMatchObject({
      options: { providerOptions: { dashscope: { enable_thinking: true, thinking_budget: 81920 } } },
      maxAttempts: 1
    })
  })

  it('allows the corrected call after earlier same-model attempts', async () => {
    const retryable = thinkingBudgetDegradeRetryable()
    const result = await retryable(
      errorContext(apiError(BAILIAN_81920), { dashscope: { enable_thinking: true, thinking_budget: 100_000 } }, [
        priorErrorAttempt(),
        priorErrorAttempt()
      ])
    )

    expect(result).toMatchObject({
      options: { providerOptions: { dashscope: { enable_thinking: true, thinking_budget: 81920 } } },
      maxAttempts: 3
    })
  })

  it('omits the budget when the SKU takes none, keeping enable_thinking', async () => {
    const retryable = thinkingBudgetDegradeRetryable()
    const result = await retryable(
      errorContext(apiError(BAILIAN_ZERO), { dashscope: { enable_thinking: true, thinking_budget: 4096 } })
    )

    expect(result).toMatchObject({
      options: { providerOptions: { dashscope: { enable_thinking: true } } },
      maxAttempts: 1
    })
    const degraded = result as unknown as { options: { providerOptions: Record<string, Record<string, unknown>> } }
    expect(degraded.options.providerOptions.dashscope).not.toHaveProperty('thinking_budget')
  })

  it('does not strip on an unparseable ceiling — surfaces with the hint instead', () => {
    const retryable = thinkingBudgetDegradeRetryable()
    expect(
      retryable(
        errorContext(apiError('API Error: 400 thinking_budget rejected', 400), {
          dashscope: { enable_thinking: true, thinking_budget: 4096 }
        })
      )
    ).toBeUndefined()
  })

  // The retryable resolves synchronously to undefined on these paths.
  it('ignores errors that are not thinking_budget rejections', () => {
    const retryable = thinkingBudgetDegradeRetryable()
    expect(
      retryable(errorContext(apiError('http 429 rate limited', 429), { dashscope: { thinking_budget: 1 } }))
    ).toBeUndefined()
  })

  it('does not retry when the budget is already within the ceiling (no-op guard)', () => {
    const retryable = thinkingBudgetDegradeRetryable()
    expect(
      retryable(errorContext(apiError(BAILIAN_81920), { dashscope: { enable_thinking: true, thinking_budget: 4096 } }))
    ).toBeUndefined()
  })

  it('does not retry when no budget leaf remains (single-shot guard)', () => {
    const retryable = thinkingBudgetDegradeRetryable()
    expect(retryable(errorContext(apiError(BAILIAN_ZERO), { dashscope: { enable_thinking: true } }))).toBeUndefined()
  })

  it('ignores result attempts', () => {
    const retryable = thinkingBudgetDegradeRetryable()
    expect(
      retryable({
        current: { type: 'result', result: {}, model: fakeModel as never, options: { prompt: [] } },
        attempts: []
      } as unknown as RetryContext<LanguageModel>)
    ).toBeUndefined()
  })
})
