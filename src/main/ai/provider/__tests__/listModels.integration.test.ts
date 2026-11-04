import { createServer, type Server } from 'node:http'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CustomFetchModule from '@main/ai/utils/customFetch'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import { makeProvider } from '../../__tests__/fixtures/provider'
import { GeminiModelsResponseSchema } from '../listModelsSchemas'

const { getRotatedApiKeyMock } = vi.hoisted(() => ({
  getRotatedApiKeyMock: vi.fn<() => string>()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getRotatedApiKey: getRotatedApiKeyMock
  }
}))

vi.mock('@main/data/services/ProviderRegistryService', () => ({
  providerRegistryService: {
    isRegistryProvider: vi.fn(() => false)
  }
}))

vi.mock('@main/services/VertexAiService', () => ({
  vertexAiService: {
    getAuthHeaders: vi.fn()
  }
}))

vi.mock('@main/services/CopilotService', () => ({
  copilotService: {
    getToken: vi.fn()
  }
}))

// Listing issues its HTTP through `customFetch` (Electron `net.fetch`, the Chromium stack),
// which has no Chromium behind it under Vitest. Delegate to Node's fetch so the real
// loopback server below stays reachable; the transport is not what this suite exercises.
vi.mock('@main/ai/utils/customFetch', async () => {
  const actual = await vi.importActual<typeof CustomFetchModule>('@main/ai/utils/customFetch')
  return {
    ...actual,
    customFetch: (input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init)
  }
})

const { listModels } = await import('../listModels')

const servers: Server[] = []

async function listen(server: Server): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not expose a TCP port')
  return address.port
}

beforeEach(() => {
  vi.clearAllMocks()
  getRotatedApiKeyMock.mockReturnValue('')
})

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
    )
  )
})

describe('listModels - Gemini pagination token compatibility', () => {
  const models = [
    { name: 'models/gemini-test', displayName: 'Gemini Test', supportedGenerationMethods: ['generateContent'] }
  ]

  it.each([
    { token: null, expected: undefined },
    { token: undefined, expected: undefined },
    { token: '', expected: '' },
    { token: 'next-page', expected: 'next-page' }
  ])('lists models with nextPageToken=$token', async ({ token, expected }) => {
    const body = { models, nextPageToken: token }
    const port = await listen(
      createServer((_request, response) => {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(body))
      })
    )
    const provider = makeProvider({
      id: 'custom-gemini',
      presetProviderId: SystemProviderIds.gemini,
      defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
      endpointConfigs: {
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: `http://127.0.0.1:${port}` }
      }
    })

    const result = await listModels(provider, undefined, { throwOnError: true })

    expect(result.models).toEqual([
      expect.objectContaining({
        id: 'custom-gemini::gemini-test',
        apiModelId: 'gemini-test',
        name: 'Gemini Test'
      })
    ])
    expect(GeminiModelsResponseSchema.parse(body).nextPageToken).toBe(expected)
  })

  it.each([123, {}, [], false])('rejects an invalid pagination token: %j', (nextPageToken) => {
    const result = GeminiModelsResponseSchema.safeParse({ models, nextPageToken })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.map((issue) => issue.path)).toContainEqual(['nextPageToken'])
  })

  it('still rejects model entries without a name when the pagination token is null', () => {
    const result = GeminiModelsResponseSchema.safeParse({
      models: [{ displayName: 'Missing ID' }],
      nextPageToken: null
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.map((issue) => issue.path)).toContainEqual(['models', 0, 'name'])
  })
})

describe('listModels - LM Studio response isolation', () => {
  it('keeps valid models in order when one response row is malformed', async () => {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/v0/models') {
        response.statusCode = 404
        response.end(JSON.stringify({ error: { message: 'not supported by this test server' } }))
        return
      }

      response.end(
        JSON.stringify({
          data: [
            { id: 'first-model', name: 'First Model' },
            'malformed-row-payload',
            { id: 'second-model', owned_by: 'lmstudio' },
            { id: 'first-model', name: 'Duplicate Model' }
          ]
        })
      )
    })
    const port = await listen(server)
    const provider = makeProvider({
      id: SystemProviderIds.lmstudio,
      presetProviderId: SystemProviderIds.lmstudio,
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: `http://127.0.0.1:${port}/v1` }
      }
    })

    const { models } = await listModels(provider)

    expect(models.map((model) => model.apiModelId)).toEqual(['first-model', 'second-model'])
    expect(models[0]?.name).toBe('First Model')
    expect(
      mockMainLoggerService.warn.mock.calls.filter(
        ([message]) => message === 'Skipped malformed OpenAI-compatible model entries'
      )
    ).toEqual([
      [
        'Skipped malformed OpenAI-compatible model entries',
        { providerId: SystemProviderIds.lmstudio, skippedModelCount: 1 }
      ]
    ])
    const logs = JSON.stringify([
      ...mockMainLoggerService.error.mock.calls,
      ...mockMainLoggerService.warn.mock.calls,
      ...mockMainLoggerService.info.mock.calls
    ])
    for (const payloadValue of [
      'malformed-row-payload',
      'first-model',
      'second-model',
      'First Model',
      'Duplicate Model'
    ]) {
      expect(logs).not.toContain(payloadValue)
    }
  })
})
