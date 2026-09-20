import { generateText } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { makeModel, makeProvider } from '../../__tests__/fixtures'
import { resolveCompressionModel } from '../resolveCompressionModel'

const { providerLookup, modelLookup, providerConfig, credential, recordInvocation } = vi.hoisted(() => ({
  providerLookup: vi.fn(),
  modelLookup: vi.fn(),
  providerConfig: vi.fn(),
  credential: { current: { attribution: 'unknown' } as Record<string, unknown> },
  recordInvocation: vi.fn()
}))
vi.mock('@main/data/services/ProviderService', () => ({ providerService: { getByProviderId: providerLookup } }))
vi.mock('@main/data/services/ModelService', () => ({ modelService: { getByKey: modelLookup } }))
vi.mock('@main/ai/provider/config', () => ({
  resolveProviderAiSdkConfig: async (...args: unknown[]) => ({
    config: await providerConfig(...args),
    credentialReceipt: credential.current
  })
}))
vi.mock('@data/services/AiUsageRecordService', () => ({ aiUsageRecordService: { recordInvocation } }))

const CONVERSATION = { id: 'conversation-1', topicId: 'topic-1' }

describe('resolveCompressionModel', () => {
  beforeEach(() => {
    recordInvocation.mockClear()
    credential.current = { attribution: 'unknown' }
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

  it.each([
    [undefined, 'small'],
    ['', 'small'],
    ['wire-small', 'wire-small']
  ])(
    'addresses the summary model using the configured wire id or unique-id fallback (%j)',
    async (apiModelId, expectedModelId) => {
      modelLookup.mockReturnValue(makeModel({ id: 'opencode::small', providerId: 'opencode', apiModelId }))
      const outgoing: unknown[] = []
      providerConfig.mockResolvedValue({
        providerId: 'openai-compatible',
        providerSettings: {
          name: 'opencode',
          baseURL: 'https://provider.test/v1',
          fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
            outgoing.push(JSON.parse(String(init?.body)).model)
            return Response.json({
              id: 'summary-1',
              created: 0,
              model: 'small',
              choices: [{ index: 0, message: { role: 'assistant', content: 'SUMMARY' }, finish_reason: 'stop' }]
            })
          }
        }
      })
      const descriptor = await resolveCompressionModel('opencode::small', CONVERSATION)
      expect(descriptor).not.toBeNull()
      const summary = await generateText({ model: descriptor!.languageModel, prompt: 'Summarize.' })
      expect(summary.text).toBe('SUMMARY')
      expect(outgoing).toEqual([expectedModelId])
    }
  )

  it('normalizes a Gemini listing id before handing the compressor to the SDK', async () => {
    providerLookup.mockReturnValue(
      makeProvider({ id: 'google', defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT })
    )
    modelLookup.mockReturnValue(
      makeModel({
        id: 'google::models/gemini-flash-latest',
        providerId: 'google',
        apiModelId: 'models/gemini-flash-latest'
      })
    )
    providerConfig.mockResolvedValue({ providerId: 'google', providerSettings: { apiKey: 'test' } })
    const descriptor = await resolveCompressionModel('google::models/gemini-flash-latest', CONVERSATION)
    expect(descriptor?.languageModel.modelId).toBe('gemini-flash-latest')
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
  // A compaction call bills the same key as a chat turn. It used to reach the
  // provider through a bare LanguageModel with no usage middleware, so it wrote
  // no aiUsageRecord row — the key's quota count then ran under its real
  // consumption and routing kept serving a key that was already exhausted.
  it('records the summary call against the serving key so quota counts it', async () => {
    credential.current = { attribution: 'matched', id: 'key-7', masked: 'sk-***7' }
    providerConfig.mockResolvedValue({
      providerId: 'openai-compatible',
      providerSettings: {
        name: 'opencode',
        baseURL: 'https://provider.test/v1',
        fetch: async () =>
          Response.json({
            id: 'summary-1',
            created: 0,
            model: 'small',
            choices: [{ index: 0, message: { role: 'assistant', content: 'SUMMARY' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }
          })
      }
    })

    const descriptor = await resolveCompressionModel('opencode::small', CONVERSATION)
    await generateText({ model: descriptor!.languageModel, prompt: 'Summarize.' })

    expect(recordInvocation).toHaveBeenCalledTimes(1)
    const recorded = recordInvocation.mock.calls[0][0]
    expect(recorded.context.credentialReceipt).toMatchObject({ id: 'key-7' })
    expect(recorded.context.providerId).toBe('opencode')
    expect(recorded.modality).toBe('language')
    expect(recorded.usage).toMatchObject({ inputTokens: 120, outputTokens: 30 })
    // Nothing here knows which assistant owns the conversation, so the row is
    // deliberately unattributed rather than guessed at.
    expect(recorded.context.source).toBeNull()
  })
})
