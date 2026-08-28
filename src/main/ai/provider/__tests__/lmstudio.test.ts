import { createExecutor } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'

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

const { providerToAiSdkConfig } = await import('../config')

beforeEach(() => {
  vi.clearAllMocks()
  resolveApiKeyMock.mockReturnValue({ value: '', apiKeySelection: { attribution: 'unknown' } })
  getAuthConfigMock.mockReturnValue(null)
})

function createLmStudioProvider(id: string = SystemProviderIds.lmstudio) {
  return makeProvider({
    id,
    presetProviderId: SystemProviderIds.lmstudio,
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
        baseUrl: 'http://localhost:1234/v1',
        adapterFamily: 'openai-compatible'
      }
    }
  })
}

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

describe('LM Studio multi-image request compatibility', () => {
  it('strips data URI prefixes from every image while preserving count and order', async () => {
    const provider = createLmStudioProvider('lmstudio-local')
    const model = makeModel({
      id: 'lmstudio-local::vision-model',
      providerId: 'lmstudio-local',
      apiModelId: 'vision-model',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })
    const config = await providerToAiSdkConfig(provider, model)
    const fetchSpy = vi.fn().mockResolvedValue(fakeSuccessResponse())
    const executor = await createExecutor(
      config.providerId as Parameters<typeof createExecutor>[0],
      { ...config.providerSettings, fetch: fetchSpy } as Parameters<typeof createExecutor>[1]
    )
    const languageModel = await executor.languageModel('vision-model')

    await languageModel.doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Compare these images' },
            { type: 'file', mediaType: 'image/png', data: 'AQID' },
            { type: 'file', mediaType: 'image/jpeg', data: 'BAUG' }
          ]
        }
      ]
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'Compare these images' },
      { type: 'image_url', image_url: { url: 'AQID' } },
      { type: 'image_url', image_url: { url: 'BAUG' } }
    ])
  })

  it('keeps the existing single-image wire format', async () => {
    const provider = createLmStudioProvider()
    const model = makeModel({ endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] })
    const config = await providerToAiSdkConfig(provider, model)
    const fetchSpy = vi.fn().mockResolvedValue(fakeSuccessResponse())
    const executor = await createExecutor(
      config.providerId as Parameters<typeof createExecutor>[0],
      { ...config.providerSettings, fetch: fetchSpy } as Parameters<typeof createExecutor>[1]
    )
    const languageModel = await executor.languageModel('vision-model')

    await languageModel.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'file', mediaType: 'image/png', data: 'AQID' }] }]
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.messages[0].content).toEqual([{ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }])
  })

  it('does not transform multi-image requests for other OpenAI-compatible providers', async () => {
    const provider = makeProvider({
      id: 'some-relay',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://relay.example.com/v1',
          adapterFamily: 'openai-compatible'
        }
      }
    })
    const model = makeModel({ endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] })
    const config = await providerToAiSdkConfig(provider, model)
    const fetchSpy = vi.fn().mockResolvedValue(fakeSuccessResponse())
    const executor = await createExecutor(
      config.providerId as Parameters<typeof createExecutor>[0],
      { ...config.providerSettings, fetch: fetchSpy } as Parameters<typeof createExecutor>[1]
    )
    const languageModel = await executor.languageModel('vision-model')

    await languageModel.doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            { type: 'file', mediaType: 'image/png', data: 'AQID' },
            { type: 'file', mediaType: 'image/jpeg', data: 'BAUG' }
          ]
        }
      ]
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.messages[0].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BAUG' } }
    ])
  })
})
