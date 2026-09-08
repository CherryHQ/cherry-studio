import { generateText } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel, makeProvider } from '../../__tests__/fixtures'
import { resolveCompressionModel } from '../resolveCompressionModel'

const { providerLookup, modelLookup, providerConfig } = vi.hoisted(() => ({
  providerLookup: vi.fn(),
  modelLookup: vi.fn(),
  providerConfig: vi.fn()
}))
vi.mock('@main/data/services/ProviderService', () => ({ providerService: { getByProviderId: providerLookup } }))
vi.mock('@main/data/services/ModelService', () => ({ modelService: { getByKey: modelLookup } }))
vi.mock('@main/ai/provider/config', () => ({ providerToAiSdkConfig: providerConfig }))

const CONVERSATION = { id: 'conversation-1', topicId: 'topic-1' }

describe('resolveCompressionModel', () => {
  beforeEach(() => {
    providerLookup.mockReturnValue(makeProvider({ id: 'opencode' }))
    modelLookup.mockReturnValue(
      makeModel({ id: 'opencode::small', providerId: 'opencode', apiModelId: 'small', contextWindow: 8_000 })
    )
    providerConfig.mockResolvedValue({
      providerId: 'openai-compatible',
      providerSettings: { name: 'opencode', baseURL: 'https://provider.test/v1' }
    })
  })

  it('returns null for a non-UniqueModelId string', async () => {
    expect(await resolveCompressionModel('not-a-unique-id', CONVERSATION)).toBeNull()
  })

  it('returns null when provider/model lookup throws', async () => {
    providerLookup.mockImplementationOnce(() => {
      throw new Error('no such provider')
    })
    expect(await resolveCompressionModel('ghost::model-x', CONVERSATION)).toBeNull()
  })

  it('budgets the summary against the compressor own window', async () => {
    expect((await resolveCompressionModel('opencode::small', CONVERSATION))?.contextWindow).toBe(8_000)
  })

  it('reports a null window when the compressor row declares none', async () => {
    modelLookup.mockReturnValue(makeModel({ contextWindow: undefined }))
    expect((await resolveCompressionModel('opencode::small', CONVERSATION))?.contextWindow).toBeNull()
  })

  it.each([undefined, 'configured-session'])(
    'sends a summary with the owning conversation or explicit provider session %j',
    async (explicitSession) => {
      const outgoing: Headers[] = []
      providerConfig.mockResolvedValue({
        providerId: 'openai-compatible',
        conversationHeader: explicitSession ? undefined : 'x-opencode-session',
        providerSettings: {
          name: 'opencode',
          baseURL: 'https://provider.test/v1',
          headers: explicitSession ? { 'X-OpenCode-Session': explicitSession } : {},
          fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
            outgoing.push(new Headers(init?.headers))
            return Response.json({
              id: 'summary-1',
              created: 0,
              model: 'small',
              choices: [{ index: 0, message: { role: 'assistant', content: 'SUMMARY' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
            })
          }
        }
      })
      const descriptor = await resolveCompressionModel('opencode::small', CONVERSATION)
      expect(descriptor).not.toBeNull()
      const summary = await generateText({ model: descriptor!.languageModel, prompt: 'Summarize this conversation.' })
      expect(summary.text).toBe('SUMMARY')
      expect(outgoing).toHaveLength(1)
      expect(outgoing[0].get('x-opencode-session')).toBe(explicitSession ?? CONVERSATION.id)
    }
  )
})
