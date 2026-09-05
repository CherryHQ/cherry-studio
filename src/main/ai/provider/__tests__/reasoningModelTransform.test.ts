import { createExecutor } from '@cherrystudio/ai-core'
import {
  applyReasoningModelMaxTokensConversion,
  createCherryIn,
  isOpenAIReasoningModelId
} from '@cherrystudio/ai-sdk-provider'
import { CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'
import { createNewApi } from '../custom/newapiProvider'

const { resolveApiKeyMock, getAuthConfigMock, getByProviderIdMock } = vi.hoisted(() => ({
  resolveApiKeyMock: vi.fn(),
  getAuthConfigMock: vi.fn(),
  getByProviderIdMock: vi.fn()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    resolveApiKey: resolveApiKeyMock,
    getAuthConfig: getAuthConfigMock,
    getByProviderId: getByProviderIdMock
  }
}))

// Import the SUT after the mock is declared.
const { providerToAiSdkConfig } = await import('../config')

beforeEach(() => {
  vi.clearAllMocks()
  resolveApiKeyMock.mockImplementation((_providerId: string, override?: string) => ({
    value: override ?? 'sk-test-key',
    apiKeySelection: override
      ? { attribution: 'unknown' }
      : { attribution: 'explicit', id: 'test-key', masked: 'sk-t****-key' }
  }))
  getAuthConfigMock.mockReturnValue(null)
})

describe('isOpenAIReasoningModelId', () => {
  it('identifies o1 models', () => {
    expect(isOpenAIReasoningModelId('o1')).toBe(true)
    expect(isOpenAIReasoningModelId('o1-mini')).toBe(true)
    expect(isOpenAIReasoningModelId('o1-preview')).toBe(true)
  })

  it('identifies o3 models', () => {
    expect(isOpenAIReasoningModelId('o3')).toBe(true)
    expect(isOpenAIReasoningModelId('o3-mini')).toBe(true)
    expect(isOpenAIReasoningModelId('o3-2025-04-16')).toBe(true)
  })

  it('identifies o4-mini', () => {
    expect(isOpenAIReasoningModelId('o4-mini')).toBe(true)
  })

  it('identifies GPT-5 models', () => {
    expect(isOpenAIReasoningModelId('gpt-5')).toBe(true)
    expect(isOpenAIReasoningModelId('gpt-5.1')).toBe(true)
    expect(isOpenAIReasoningModelId('gpt-5.2')).toBe(true)
  })

  it('identifies GPT-6 Astra', () => {
    expect(isOpenAIReasoningModelId('gpt-6-astra')).toBe(true)
  })

  it('excludes gpt-5-chat', () => {
    expect(isOpenAIReasoningModelId('gpt-5-chat')).toBe(false)
  })

  it('excludes non-reasoning models', () => {
    expect(isOpenAIReasoningModelId('gpt-4o')).toBe(false)
    expect(isOpenAIReasoningModelId('gpt-4-turbo')).toBe(false)
    expect(isOpenAIReasoningModelId('claude-sonnet-4-6')).toBe(false)
    expect(isOpenAIReasoningModelId('o4')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isOpenAIReasoningModelId('O1')).toBe(true)
    expect(isOpenAIReasoningModelId('GPT-5')).toBe(true)
    expect(isOpenAIReasoningModelId('O4-MINI')).toBe(true)
  })
})

describe('applyReasoningModelMaxTokensConversion', () => {
  it('converts max_tokens to max_completion_tokens for reasoning models', () => {
    const body = { model: 'o3', max_tokens: 1000, messages: [] }
    const result = applyReasoningModelMaxTokensConversion(body) as Record<string, unknown>
    expect(result.max_completion_tokens).toBe(1000)
    expect(result.max_tokens).toBeUndefined()
  })

  it('converts for GPT-5 models', () => {
    const body = { model: 'gpt-5', max_tokens: 128000 }
    const result = applyReasoningModelMaxTokensConversion(body) as Record<string, unknown>
    expect(result.max_completion_tokens).toBe(128000)
    expect(result.max_tokens).toBeUndefined()
  })

  it('converts for GPT-6 Astra', () => {
    const body = { model: 'gpt-6-astra', max_tokens: 128000 }
    const result = applyReasoningModelMaxTokensConversion(body) as Record<string, unknown>
    expect(result.max_completion_tokens).toBe(128000)
    expect(result.max_tokens).toBeUndefined()
  })

  it('passes through non-reasoning models unchanged', () => {
    const body = { model: 'gpt-4o', max_tokens: 4096 }
    const result = applyReasoningModelMaxTokensConversion(body) as Record<string, unknown>
    expect(result.max_tokens).toBe(4096)
    expect(result.max_completion_tokens).toBeUndefined()
  })

  it('passes through when max_tokens is absent', () => {
    const body = { model: 'o3', messages: [] }
    const result = applyReasoningModelMaxTokensConversion(body) as Record<string, unknown>
    expect(result).toEqual(body)
  })

  it('passes through when model field is missing', () => {
    const body = { max_tokens: 1000 }
    const result = applyReasoningModelMaxTokensConversion(body)
    expect(result).toEqual(body)
  })

  it('keeps an explicit max_completion_tokens and still drops max_tokens', () => {
    const body = { model: 'gpt-5', max_tokens: 4096, max_completion_tokens: 8192 }
    const result = applyReasoningModelMaxTokensConversion(body) as Record<string, unknown>
    expect(result.max_completion_tokens).toBe(8192)
    expect(result.max_tokens).toBeUndefined()
  })

  it('preserves other body fields', () => {
    const body = { model: 'o3', max_tokens: 1000, temperature: 0.7, stream: true }
    const result = applyReasoningModelMaxTokensConversion(body) as Record<string, unknown>
    expect(result.temperature).toBe(0.7)
    expect(result.stream).toBe(true)
    expect(result.max_completion_tokens).toBe(1000)
  })
})

/** Minimal valid OpenAI chat completion response for doGenerate. */
function fakeSuccessResponse() {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-fake',
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

describe('wire-body regression through real construction paths', () => {
  it('default OpenAI-compatible path (providerToAiSdkConfig → createExecutor) rewrites max_tokens on the wire', async () => {
    const provider = makeProvider({
      id: 'some-relay',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example.com/v1' }
      }
    })
    const model = makeModel({
      apiModelId: 'o3',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })

    const config = await providerToAiSdkConfig(provider, model)
    expect(config.providerId).toBe('openai-compatible')

    const fetchSpy = vi.fn().mockResolvedValue(fakeSuccessResponse())
    const executor = await createExecutor(
      config.providerId as Parameters<typeof createExecutor>[0],
      { ...config.providerSettings, fetch: fetchSpy } as Parameters<typeof createExecutor>[1]
    )
    const languageModel = await executor.languageModel('o3')

    await languageModel.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 1000
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.max_completion_tokens).toBe(1000)
    expect(body.max_tokens).toBeUndefined()
  })

  it('rewrites max_tokens for GPT-6 Astra through the OpenAI-compatible Chat path', async () => {
    const provider = makeProvider({
      id: 'openai',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.com/v1' }
      }
    })
    const model = makeModel({
      apiModelId: 'gpt-6-astra',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })

    const config = await providerToAiSdkConfig(provider, model)
    expect(config.providerId).toBe('openai-compatible')

    const fetchSpy = vi.fn().mockResolvedValue(fakeSuccessResponse())
    const executor = await createExecutor(
      config.providerId as Parameters<typeof createExecutor>[0],
      { ...config.providerSettings, fetch: fetchSpy } as Parameters<typeof createExecutor>[1]
    )
    const languageModel = await executor.languageModel('gpt-6-astra')

    await languageModel.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 128000
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.max_completion_tokens).toBe(128000)
    expect(body.max_tokens).toBeUndefined()
  })

  it('NewAPI createNewApi path rewrites max_tokens on the wire', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(fakeSuccessResponse())
    const provider = createNewApi({
      baseURL: 'https://newapi.example.com/v1',
      apiKey: 'sk-test',
      fetch: fetchSpy,
      endpointType: 'openai'
    })

    const model = provider.languageModel('o3')
    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 2000
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.max_completion_tokens).toBe(2000)
    expect(body.max_tokens).toBeUndefined()
  })

  it('CherryIn createCherryIn path rewrites max_tokens on the wire', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(fakeSuccessResponse())
    const provider = createCherryIn({
      baseURL: 'https://open.cherryin.net/v1',
      apiKey: 'sk-test',
      fetch: fetchSpy,
      endpointType: 'openai'
    })

    const model = provider.chat('gpt-5')
    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 4096
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.max_completion_tokens).toBe(4096)
    expect(body.max_tokens).toBeUndefined()
  })

  it('CherryAI path (own providerSettings builder) rewrites max_tokens on the wire', async () => {
    const provider = makeProvider({
      id: CHERRYAI_PROVIDER_ID,
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://cherryai.example.com' }
      }
    })
    const model = makeModel({ apiModelId: 'gpt-5', endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] })

    const config = await providerToAiSdkConfig(provider, model)
    expect(config.providerId).toBe('openai-compatible')

    const fetchSpy = vi.fn().mockResolvedValue(fakeSuccessResponse())
    const executor = await createExecutor(
      config.providerId as Parameters<typeof createExecutor>[0],
      {
        ...config.providerSettings,
        fetch: fetchSpy
      } as Parameters<typeof createExecutor>[1]
    )
    const languageModel = await executor.languageModel('gpt-5')

    await languageModel.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 512
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.max_completion_tokens).toBe(512)
    expect(body.max_tokens).toBeUndefined()
  })
})
