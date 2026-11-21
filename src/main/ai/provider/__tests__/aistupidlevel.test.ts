import type { JSONSchema7 } from '@ai-sdk/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createExecutor } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

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
  resolveApiKeyMock.mockReturnValue({ value: 'aism_test', apiKeySelection: { attribution: 'unknown' } })
  getAuthConfigMock.mockReturnValue(null)
})

function openAICompatibleProvider(id: string, baseUrl: string, presetProviderId?: string) {
  return makeProvider({
    id,
    ...(presetProviderId ? { presetProviderId } : {}),
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl, adapterFamily: 'openai-compatible' }
    }
  })
}

const READ_FILE_ARGS: JSONSchema7 = {
  type: 'object',
  properties: { path: { type: 'string' } },
  required: ['path'],
  additionalProperties: false
}

function fakeJsonResponse() {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-fake',
      choices: [{ message: { role: 'assistant', content: '{"path":"README.md"}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

/** One structured-output call, as tool-call repair makes it, through the provider's real adapter settings. */
async function structuredRequestBody(provider: ReturnType<typeof makeProvider>) {
  const model = makeModel({
    id: `${provider.id}::auto-tooling`,
    providerId: provider.id,
    apiModelId: 'auto-tooling',
    endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
  })
  const config = await providerToAiSdkConfig(provider, model)
  const fetchSpy = vi.fn().mockResolvedValue(fakeJsonResponse())
  const executor = await createExecutor(
    config.providerId as Parameters<typeof createExecutor>[0],
    { ...config.providerSettings, fetch: fetchSpy } as Parameters<typeof createExecutor>[1]
  )
  const languageModel = await executor.languageModel('auto-tooling')

  await languageModel.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Repair the read_file call' }] }],
    responseFormat: { type: 'json', name: 'read_file', schema: READ_FILE_ARGS }
  })

  return JSON.parse(fetchSpy.mock.calls[0][1].body)
}

describe('AI Stupid Level structured output', () => {
  it('sends the JSON schema to the router as response_format.json_schema', async () => {
    const body = await structuredRequestBody(
      openAICompatibleProvider('aistupidlevel', 'https://aistupidlevel.info/v1', 'aistupidlevel')
    )

    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'read_file', schema: READ_FILE_ARGS }
    })
  })

  it('keeps the schema for a copy of the preset under its own provider id', async () => {
    const body = await structuredRequestBody(
      openAICompatibleProvider('aistupidlevel-team', 'https://aistupidlevel.info/v1', 'aistupidlevel')
    )

    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { schema: READ_FILE_ARGS } })
  })

  it('leaves other OpenAI-compatible providers on json_object', async () => {
    const body = await structuredRequestBody(openAICompatibleProvider('some-relay', 'https://relay.example.com/v1'))

    expect(body.response_format).toEqual({ type: 'json_object' })
  })
})
