import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel, makeProvider } from './fixtures'

const { resolveConfig, getProvider, getModel } = vi.hoisted(() => ({
  resolveConfig: vi.fn(),
  getProvider: vi.fn(),
  getModel: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mock = mockApplicationFactory()
  const getPath = mock.application.getPath.getMockImplementation()!
  mock.application.getPath.mockImplementation((key, filename) =>
    key === 'feature.provider_registry.data'
      ? path.join(process.cwd(), 'packages/provider-registry/data', filename ?? '')
      : getPath(key, filename)
  )
  return mock
})
vi.mock('../provider/config', () => ({ resolveProviderAiSdkConfig: resolveConfig }))
vi.mock('@main/data/services/ProviderService', () => ({ providerService: { getByProviderId: getProvider } }))
vi.mock('@main/data/services/ModelService', () => ({ modelService: { getByKey: getModel } }))

const { AiService } = await import('../AiService')

describe('MCP sampling provider request', () => {
  beforeEach(() => {
    getProvider.mockReturnValue(makeProvider())
    getModel.mockReturnValue(makeModel({ apiModelId: 'gpt-4' }))
  })

  it('delivers sampling messages through the real non-streaming pipeline without tools or conversation context', async () => {
    const outgoing: Record<string, unknown>[] = []
    resolveConfig.mockResolvedValue({
      config: {
        providerId: 'openai-compatible',
        providerSettings: {
          name: 'sampling-test',
          baseURL: 'https://sampling.test/v1',
          fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
            outgoing.push(JSON.parse(String(init?.body)))
            return Response.json({
              id: 'sampling-1',
              created: 0,
              model: 'gpt-4',
              choices: [
                { index: 0, message: { role: 'assistant', content: 'Sampling answer' }, finish_reason: 'stop' }
              ],
              usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
            })
          }
        }
      },
      credentialReceipt: { attribution: 'unknown' }
    })
    const service = new AiService()
    const result = await service.generateMcpSampling(
      'openai::gpt-4',
      {
        systemPrompt: 'Only answer this sampling request.',
        maxTokens: 30,
        temperature: 0.2,
        messages: [{ role: 'user', content: { type: 'text', text: 'Sampling question' } }]
      },
      new AbortController().signal
    )
    expect(result).toMatchObject({ content: { type: 'text', text: 'Sampling answer' }, stopReason: 'endTurn' })
    expect(outgoing).toHaveLength(1)
    expect(outgoing[0]).toMatchObject({
      messages: [
        { role: 'system', content: 'Only answer this sampling request.' },
        { role: 'user', content: 'Sampling question' }
      ],
      temperature: 0.2
    })
    expect(outgoing[0].tools).toBeUndefined()
  })
})
