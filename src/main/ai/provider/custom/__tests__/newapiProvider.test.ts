import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createNewApi, type NewApiEndpointType } from '../newapiProvider'

const prompt: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]

async function captureHeaders(endpointType: NewApiEndpointType, apiKey?: string): Promise<Headers> {
  let headers: Headers | undefined
  const fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    headers = new Headers(init?.headers)
    return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
  }) as typeof globalThis.fetch

  const model = createNewApi({ baseURL: 'http://localhost:3000/v1', endpointType, apiKey, fetch }).languageModel(
    'test-model'
  )

  try {
    await model.doGenerate({ prompt })
  } catch (error) {
    if (!headers) throw error
  }

  if (!headers) throw new Error('No request was made')
  return headers
}

describe('createNewApi authentication', () => {
  beforeEach(() => vi.stubEnv('NEWAPI_API_KEY', undefined))
  afterEach(() => vi.unstubAllEnvs())

  for (const endpointType of ['openai', 'openai-response', 'anthropic', 'gemini'] as const) {
    it(`allows anonymous ${endpointType} requests without empty authentication headers`, async () => {
      const headers = await captureHeaders(endpointType)

      expect(headers.has('authorization')).toBe(false)
      expect(headers.has('x-api-key')).toBe(false)
      expect(headers.has('x-goog-api-key')).toBe(false)
    })
  }

  it('sends configured credentials to an Anthropic route', async () => {
    const headers = await captureHeaders('anthropic', 'sk-test')

    expect(headers.get('authorization')).toBe('Bearer sk-test')
    expect(headers.get('x-api-key')).toBe('sk-test')
  })

  it('sends configured credentials to a Gemini route', async () => {
    const headers = await captureHeaders('gemini', 'sk-test')

    expect(headers.get('authorization')).toBe('Bearer sk-test')
    expect(headers.get('x-goog-api-key')).toBe('sk-test')
  })
})
