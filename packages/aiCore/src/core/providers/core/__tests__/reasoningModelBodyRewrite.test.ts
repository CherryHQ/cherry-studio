import { describe, expect, it, vi } from 'vitest'

import {
  isMaxCompletionTokensModel,
  rewriteMaxTokensToMaxCompletionTokens,
  withReasoningModelBodyRewrite
} from '../reasoningModelBodyRewrite'

describe('isMaxCompletionTokensModel', () => {
  it('matches GPT-5.x and o-series ids, including vendor prefixes', () => {
    for (const id of ['gpt-5', 'gpt-5-mini', 'gpt-5-2025-08-07', 'openai/gpt-5', 'o1', 'o3-mini', 'o4-mini']) {
      expect(isMaxCompletionTokensModel(id), id).toBe(true)
    }
  })

  it('does not match ids that merely resemble the reasoning families', () => {
    for (const id of ['gpt-4o', 'gpt-4.1', 'gpt-50', 'omni-1', 'deepseek-v4-flash', 'openrouter/o1x']) {
      expect(isMaxCompletionTokensModel(id), id).toBe(false)
    }
  })

  it('rejects non-string input', () => {
    expect(isMaxCompletionTokensModel(undefined)).toBe(false)
    expect(isMaxCompletionTokensModel(123)).toBe(false)
  })
})

describe('rewriteMaxTokensToMaxCompletionTokens', () => {
  const body = (model: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ model, messages: [], max_tokens: 128000, ...extra })

  it('moves max_tokens to max_completion_tokens for reasoning-family models', () => {
    const rewritten = JSON.parse(rewriteMaxTokensToMaxCompletionTokens(body('gpt-5')))
    expect(rewritten.max_completion_tokens).toBe(128000)
    expect(rewritten.max_tokens).toBeUndefined()
    expect(rewritten.model).toBe('gpt-5')
  })

  it('rewrites vendor-prefixed ids', () => {
    expect(rewriteMaxTokensToMaxCompletionTokens(body('openai/o3-mini'))).toContain('"max_completion_tokens":128000')
  })

  it('leaves non-reasoning models untouched', () => {
    const raw = body('deepseek-v4-flash')
    expect(rewriteMaxTokensToMaxCompletionTokens(raw)).toBe(raw)
  })

  it('leaves bodies without max_tokens untouched', () => {
    const raw = JSON.stringify({ model: 'gpt-5', messages: [] })
    expect(rewriteMaxTokensToMaxCompletionTokens(raw)).toBe(raw)
  })

  it('never clobbers an explicit max_completion_tokens', () => {
    const raw = body('gpt-5', { max_completion_tokens: 4096 })
    expect(rewriteMaxTokensToMaxCompletionTokens(raw)).toBe(raw)
  })

  it('passes through malformed and non-object bodies', () => {
    expect(rewriteMaxTokensToMaxCompletionTokens('not-json{')).toBe('not-json{')
    expect(rewriteMaxTokensToMaxCompletionTokens('123')).toBe('123')
    expect(rewriteMaxTokensToMaxCompletionTokens('["gpt-5"]')).toBe('["gpt-5"]')
  })
})

describe('withReasoningModelBodyRewrite', () => {
  const responseBody = () => new Response('{}', { status: 200 })

  it('forwards requests without the legacy param untouched', async () => {
    const baseFetch = vi.fn(async () => responseBody())
    const wrapped = withReasoningModelBodyRewrite(baseFetch)
    const init = { method: 'POST', body: JSON.stringify({ model: 'gpt-4o', messages: [] }) }
    await wrapped('https://example.com/v1/chat/completions', init)
    expect(baseFetch).toHaveBeenCalledWith('https://example.com/v1/chat/completions', init)
  })

  it('rewrites only the body of matching reasoning-model requests', async () => {
    const baseFetch = vi.fn<typeof fetch>(async () => responseBody())
    const wrapped = withReasoningModelBodyRewrite(baseFetch)
    const headers = { 'content-type': 'application/json' }
    await wrapped('https://example.com/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'gpt-5', messages: [], max_tokens: 4096 })
    })
    const [, forwarded] = baseFetch.mock.calls[0]
    expect(forwarded?.headers).toEqual(headers)
    expect(JSON.parse(String(forwarded?.body))).toEqual({
      model: 'gpt-5',
      messages: [],
      max_completion_tokens: 4096
    })
  })

  it('passes through string bodies that fail the cheap pre-check without parsing', async () => {
    const baseFetch = vi.fn(async () => responseBody())
    const wrapped = withReasoningModelBodyRewrite(baseFetch)
    const init = { method: 'POST', body: 'plain-text-echo' }
    await wrapped('https://example.com/other', init)
    expect(baseFetch).toHaveBeenCalledWith('https://example.com/other', init)
  })

  it('forwards Request-object invocations as-is', async () => {
    const baseFetch = vi.fn(async () => responseBody())
    const wrapped = withReasoningModelBodyRewrite(baseFetch)
    const request = new Request('https://example.com/v1/chat/completions', { method: 'POST' })
    await wrapped(request)
    expect(baseFetch).toHaveBeenCalledWith(request, undefined)
  })
})
