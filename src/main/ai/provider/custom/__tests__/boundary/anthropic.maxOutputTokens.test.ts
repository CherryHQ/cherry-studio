import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createNewApi } from '../../newapiProvider'
import { captureWithFetch } from './captureRequest'

const prompt: LanguageModelV3CallOptions['prompt'] = [
  { role: 'user', content: [{ type: 'text', text: 'Continue until complete.' }] }
]

function captureRequest(modelFactory: (fetch: typeof globalThis.fetch) => LanguageModelV3, options = {}) {
  return captureWithFetch((fetch) => modelFactory(fetch).doStream({ prompt, ...options }))
}

function bodyOf(request: Awaited<ReturnType<typeof captureWithFetch>>): Record<string, unknown> {
  return request.body as Record<string, unknown>
}

describe('@ai-sdk/anthropic maxOutputTokens boundary', () => {
  it('omits max_tokens for an unknown public Anthropic model when no limit is supplied', async () => {
    const request = await captureRequest((fetch) =>
      createAnthropic({ apiKey: 'sk', baseURL: 'https://example.com/v1', fetch }).languageModel('minimax-m2.5')
    )

    expect(bodyOf(request)).not.toHaveProperty('max_tokens')
  })

  it('omits max_tokens for an unknown internal Anthropic model when no limit is supplied', async () => {
    const request = await captureRequest((fetch) =>
      createNewApi({
        apiKey: 'sk',
        baseURL: 'https://example.com/v1',
        endpointType: 'anthropic',
        fetch
      }).languageModel('qwen3.5-plus')
    )

    expect(bodyOf(request)).not.toHaveProperty('max_tokens')
  })

  it('sends an explicit maxOutputTokens unchanged', async () => {
    const request = await captureRequest(
      (fetch) =>
        createAnthropic({ apiKey: 'sk', baseURL: 'https://example.com/v1', fetch }).languageModel('minimax-m2.5'),
      { maxOutputTokens: 32_768 }
    )

    expect(bodyOf(request).max_tokens).toBe(32_768)
  })

  it('keeps the SDK default for a recognized Claude model', async () => {
    const request = await captureRequest((fetch) =>
      createAnthropic({ apiKey: 'sk', baseURL: 'https://example.com/v1', fetch }).languageModel('claude-sonnet-4-6')
    )

    expect(bodyOf(request).max_tokens).toBe(128_000)
  })

  it('keeps the SDK fallback for an unrecognized public Claude alias', async () => {
    const request = await captureRequest((fetch) =>
      createAnthropic({ apiKey: 'sk', baseURL: 'https://example.com/v1', fetch }).languageModel('claude-sonnet-latest')
    )

    expect(bodyOf(request).max_tokens).toBe(128_000)
  })

  it('keeps the SDK fallback for an unrecognized internal Claude alias', async () => {
    const request = await captureRequest((fetch) =>
      createNewApi({
        apiKey: 'sk',
        baseURL: 'https://example.com/v1',
        endpointType: 'anthropic',
        fetch
      }).languageModel('claude-sonnet-latest')
    )

    expect(bodyOf(request).max_tokens).toBe(128_000)
  })

  it('does not synthesize max_tokens when thinking is enabled without a limit', async () => {
    const request = await captureRequest(
      (fetch) =>
        createAnthropic({ apiKey: 'sk', baseURL: 'https://example.com/v1', fetch }).languageModel('minimax-m2.5'),
      {
        providerOptions: {
          anthropic: {
            thinking: { type: 'enabled', budgetTokens: 2048 }
          }
        }
      }
    )

    expect(bodyOf(request).thinking).toEqual({ type: 'enabled', budget_tokens: 2048 })
    expect(bodyOf(request)).not.toHaveProperty('max_tokens')
  })
})
