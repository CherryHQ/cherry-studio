import { APICallError, RetryError } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  appendThinkingBudgetHint,
  clampThinkingBudget,
  hasThinkingBudget,
  isThinkingBudgetRejection,
  parseThinkingBudgetCeiling,
  stripThinkingBudget,
  THINKING_BUDGET_HINT,
  thinkingBudgetRejectionText
} from '../thinkingBudget'

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

describe('isThinkingBudgetRejection', () => {
  it('matches the Bailian over-ceiling rejection', () => {
    expect(isThinkingBudgetRejection(apiError(BAILIAN_81920))).toBe(true)
  })

  it('matches the unsupported-SKU (max 0) rejection', () => {
    expect(isThinkingBudgetRejection(apiError(BAILIAN_ZERO))).toBe(true)
  })

  it('rejects a 400 that names no reasoning parameter', () => {
    expect(isThinkingBudgetRejection(apiError('API Error: 400 bad request: unknown field "foo"'))).toBe(false)
  })

  it('rejects a thinking_budget mention without a bad-request signal', () => {
    expect(isThinkingBudgetRejection(apiError('thinking_budget is set', 500))).toBe(false)
  })

  it('follows RetryError nesting to the last error', () => {
    const retry = new RetryError({
      message: 'Failed after retries',
      reason: 'maxRetriesExceeded',
      errors: [apiError(BAILIAN_81920)]
    })
    expect(isThinkingBudgetRejection(retry)).toBe(true)
  })

  it('reads plain serialized error shapes', () => {
    expect(isThinkingBudgetRejection({ statusCode: 400, message: BAILIAN_81920 })).toBe(true)
  })

  it('reads the OpenAI error-envelope shape', () => {
    expect(isThinkingBudgetRejection({ status: 400, error: { message: BAILIAN_81920 } })).toBe(true)
  })
})

describe('parseThinkingBudgetCeiling', () => {
  it.each([
    [BAILIAN_81920, 81920],
    ['The thinking_budget parameter must be a positive integer and not greater than 131072', 131072],
    [BAILIAN_ZERO, 0]
  ])('parses %s', (message, ceiling) => {
    expect(parseThinkingBudgetCeiling(apiError(message))).toBe(ceiling)
  })

  it('returns undefined when the text names no ceiling', () => {
    expect(parseThinkingBudgetCeiling(apiError('thinking_budget invalid'))).toBeUndefined()
  })
})

describe('clampThinkingBudget', () => {
  it('clamps an over-ceiling leaf and keeps its siblings', () => {
    const providerOptions = { openai: { enable_thinking: true, thinking_budget: 100_000 } }
    const { providerOptions: clamped, changed } = clampThinkingBudget(providerOptions, 81920)
    expect(changed).toBe(true)
    expect(clamped).toEqual({ openai: { enable_thinking: true, thinking_budget: 81920 } })
  })

  it('clamps nested extra_body leaves', () => {
    const providerOptions = { custom: { extra_body: { thinking_budget: 200_000 } } }
    const { providerOptions: clamped, changed } = clampThinkingBudget(providerOptions, 131072)
    expect(changed).toBe(true)
    expect(clamped).toEqual({ custom: { extra_body: { thinking_budget: 131072 } } })
  })

  it('returns the original reference when every leaf is within range', () => {
    const providerOptions = { openai: { enable_thinking: true, thinking_budget: 4096 } }
    const { providerOptions: kept, changed } = clampThinkingBudget(providerOptions, 81920)
    expect(changed).toBe(false)
    expect(kept).toBe(providerOptions)
  })

  it('returns the original reference when no leaf is present', () => {
    const providerOptions = { openai: { enable_thinking: true } }
    const { providerOptions: kept, changed } = clampThinkingBudget(providerOptions, 81920)
    expect(changed).toBe(false)
    expect(kept).toBe(providerOptions)
  })

  it('reaches leaves nested inside arrays, agreeing with hasThinkingBudget', () => {
    const providerOptions = { custom: { items: [{ thinking_budget: 200_000 }] } }
    expect(hasThinkingBudget(providerOptions)).toBe(true)
    const { providerOptions: clamped, changed } = clampThinkingBudget(providerOptions, 81920)
    expect(changed).toBe(true)
    expect(clamped).toEqual({ custom: { items: [{ thinking_budget: 81920 }] } })
  })
})

describe('stripThinkingBudget', () => {
  it('drops the budget leaf and keeps enable_thinking', () => {
    const { providerOptions: stripped, changed } = stripThinkingBudget({
      openai: { enable_thinking: true, thinking_budget: 4096, reasoningEffort: 'high' }
    })
    expect(changed).toBe(true)
    expect(stripped).toEqual({ openai: { enable_thinking: true, reasoningEffort: 'high' } })
  })

  it('returns the original reference when no leaf is present', () => {
    const providerOptions = { openai: { enable_thinking: true } }
    const { providerOptions: kept, changed } = stripThinkingBudget(providerOptions)
    expect(changed).toBe(false)
    expect(kept).toBe(providerOptions)
  })

  it('detects presence without transforming', () => {
    expect(hasThinkingBudget({ a: { thinking_budget: 1 } })).toBe(true)
    expect(hasThinkingBudget({ a: { enable_thinking: true } })).toBe(false)
    expect(hasThinkingBudget(undefined)).toBe(false)
  })
})

describe('thinkingBudgetRejectionText', () => {
  it('finds the provider wording through RetryError nesting', () => {
    const retry = new RetryError({
      message: 'Failed after retries',
      reason: 'maxRetriesExceeded',
      errors: [apiError(BAILIAN_81920)]
    })
    expect(thinkingBudgetRejectionText(retry)).toBe(BAILIAN_81920)
  })

  it('returns undefined when no text names the parameter', () => {
    expect(thinkingBudgetRejectionText(apiError('http 429 rate limited', 429))).toBeUndefined()
  })
})

describe('appendThinkingBudgetHint', () => {
  it('appends the hint naming the setting', () => {
    const message = appendThinkingBudgetHint(BAILIAN_81920)
    expect(message).toContain(BAILIAN_81920)
    expect(message).toContain(THINKING_BUDGET_HINT)
  })

  it('appends without requiring the parameter text (wrapped errors)', () => {
    const message = appendThinkingBudgetHint('Failed after retries')
    expect(message).toContain(THINKING_BUDGET_HINT)
  })

  it('is idempotent', () => {
    expect(appendThinkingBudgetHint(appendThinkingBudgetHint(BAILIAN_81920))).toBe(
      appendThinkingBudgetHint(BAILIAN_81920)
    )
  })
})
