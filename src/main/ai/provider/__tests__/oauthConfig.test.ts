import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'

const mocks = vi.hoisted(() => ({
  authenticatedFetch: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ OAuthRuntimeService: { authenticatedFetch: mocks.authenticatedFetch } } as never)
})

const { providerToAiSdkConfig } = await import('../config')

type CapturedRequest = { input: RequestInfo | URL; init: RequestInit }

let capturedRequest: CapturedRequest | undefined

beforeEach(() => {
  vi.clearAllMocks()
  capturedRequest = undefined
  mocks.authenticatedFetch.mockImplementation(
    async (
      _providerId: string,
      buildRequest: (credentials: { accessToken: string; accountId?: string | null }) => CapturedRequest
    ) => {
      capturedRequest = buildRequest({ accessToken: 'oauth-token', accountId: 'account-1' })
      return new Response('ok', { status: 200 })
    }
  )
})

function makeOAuthProvider(id: string, baseUrl: string) {
  return makeProvider({
    id,
    authMethods: ['oauth'],
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_RESPONSES]: { adapterFamily: 'openai', baseUrl }
    }
  })
}

describe('OAuth provider configs used by the API Gateway', () => {
  it('builds Codex requests with the refreshed OAuth credential and backend shape', async () => {
    const provider = makeOAuthProvider('openai-codex', 'https://chatgpt.com/backend-api/codex')
    const model = makeModel({
      id: 'openai-codex::gpt-5-codex',
      providerId: 'openai-codex',
      apiModelId: 'gpt-5-codex',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
    })

    const config = await providerToAiSdkConfig(provider, model)
    const settings = config.providerSettings as { baseURL: string; fetch: typeof fetch }
    await settings.fetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5-codex', store: true, max_output_tokens: 100 })
    })

    expect(settings.baseURL).toBe('https://chatgpt.com/backend-api/codex')
    expect(mocks.authenticatedFetch).toHaveBeenCalledWith(
      'openai-codex',
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ notSignedInMessage: expect.stringContaining('OpenAI Codex') })
    )
    expect(capturedRequest?.input).toBe('https://chatgpt.com/backend-api/codex/responses')
    const headers = new Headers(capturedRequest?.init.headers)
    expect(headers.get('authorization')).toBe('Bearer oauth-token')
    expect(headers.get('chatgpt-account-id')).toBe('account-1')
    expect(headers.get('openai-beta')).toBe('responses=experimental')
    expect(headers.get('originator')).toBe('cherry-studio')
    expect(JSON.parse(String(capturedRequest?.init.body))).toEqual({
      model: 'gpt-5-codex',
      store: false,
      include: ['reasoning.encrypted_content']
    })
  })

  it('builds Grok requests with the refreshed OAuth credential and proxy shape', async () => {
    const provider = makeOAuthProvider('grok-cli', 'https://cli-chat-proxy.grok.com/v1')
    const model = makeModel({
      id: 'grok-cli::grok-build',
      providerId: 'grok-cli',
      apiModelId: 'grok-build',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
    })

    const config = await providerToAiSdkConfig(provider, model)
    const settings = config.providerSettings as { baseURL: string; fetch: typeof fetch }
    await settings.fetch('https://cli-chat-proxy.grok.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({
        model: 'grok-build',
        input: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'hello' },
          { type: 'reasoning', encrypted_content: 'old' }
        ],
        reasoning: { effort: 'high' },
        include: ['reasoning.encrypted_content']
      })
    })

    expect(settings.baseURL).toBe('https://cli-chat-proxy.grok.com/v1')
    expect(mocks.authenticatedFetch).toHaveBeenCalledWith(
      'grok-cli',
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ notSignedInMessage: expect.stringContaining('Grok CLI') })
    )
    const headers = new Headers(capturedRequest?.init.headers)
    expect(headers.get('authorization')).toBe('Bearer oauth-token')
    expect(headers.get('x-grok-client-identifier')).toBe('cherry-studio')
    expect(headers.get('x-grok-client-version')).toBe('0.2.16')
    expect(headers.get('x-xai-token-auth')).toBe('xai-grok-cli')
    expect(headers.get('x-grok-model-override')).toBe('grok-build')
    expect(JSON.parse(String(capturedRequest?.init.body))).toEqual({
      model: 'grok-build',
      instructions: 'system prompt',
      input: [{ role: 'user', content: 'hello' }]
    })
  })
})
