import os from 'node:os'

import { generateText } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { summarizeModelMessages } from '@cherrystudio/ai-core'
import type * as AiCoreModule from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { makeModel, makeProvider } from '../../__tests__/fixtures'
import { resolveCompressionBudget } from '../resolveCompressionBudget'
import { resolveCompressionModel } from '../resolveCompressionModel'

const { providerLookup, modelLookup, providerConfig, compressionExecutor, defaultExecutor } = vi.hoisted(() => ({
  providerLookup: vi.fn(),
  modelLookup: vi.fn(),
  providerConfig: vi.fn(),
  compressionExecutor: vi.fn(),
  defaultExecutor: vi.fn()
}))
vi.mock('@cherrystudio/ai-core', async (importOriginal) => {
  const actual = await importOriginal<typeof AiCoreModule>()
  defaultExecutor.mockImplementation(actual.createExecutor)
  compressionExecutor.mockImplementation(defaultExecutor)
  return { ...actual, createExecutor: compressionExecutor }
})
vi.mock('@main/data/services/ProviderService', () => ({ providerService: { getByProviderId: providerLookup } }))
vi.mock('@main/data/services/ModelService', () => ({ modelService: { getByKey: modelLookup } }))
vi.mock('@main/ai/provider/config', () => ({
  resolveProviderAiSdkConfig: async (...args: unknown[]) => ({
    config: await providerConfig(...args),
    credentialReceipt: { attribution: 'unknown' }
  })
}))

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
})

describe('Ollama compressor request window', () => {
  function setupCompressor() {
    const calls: unknown[] = []
    const doGenerate = vi.fn(async (params: unknown) => {
      calls.push(params)
      return {
        content: [{ type: 'text', text: 'SUMMARY' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: []
      }
    })
    compressionExecutor.mockReturnValue({
      languageModel: async () => ({
        specificationVersion: 'v3',
        provider: 'ollama.responses',
        modelId: 'qwen3',
        supportedUrls: {},
        doGenerate,
        doStream: vi.fn()
      })
    })
    providerLookup.mockReturnValue(
      makeProvider({
        id: 'ollama',
        endpointConfigs: { [ENDPOINT_TYPE.OLLAMA_CHAT]: { baseUrl: 'http://localhost:11434' } },
        defaultChatEndpoint: ENDPOINT_TYPE.OLLAMA_CHAT
      })
    )
    modelLookup.mockReturnValue(
      makeModel({ id: 'ollama::qwen3', providerId: 'ollama', apiModelId: 'qwen3', contextWindow: 32768 })
    )
    providerConfig.mockResolvedValue({
      providerId: 'ollama',
      providerSettings: {},
      conversationHeader: 'x-test-session'
    })
    vi.spyOn(os, 'freemem').mockReturnValue(125 * 1024 * 1024)
    vi.spyOn(os, 'totalmem').mockReturnValue(16 * 1024 * 1024 * 1024)
    return { calls, doGenerate }
  }

  afterEach(() => {
    compressionExecutor.mockReset()
    vi.restoreAllMocks()
  })

  it('freezes the compressor own effective window and sends matching num_ctx plus owning session header', async () => {
    const { calls } = setupCompressor()
    const descriptor = await resolveCompressionModel('ollama::qwen3', CONVERSATION)
    expect(descriptor?.contextWindow).toBe(4096)
    vi.mocked(os.freemem).mockReturnValue(16 * 1024 * 1024 * 1024)
    await generateText({ model: descriptor!.languageModel, prompt: 'short summary request', maxOutputTokens: 512 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      providerOptions: { ollama: { options: { num_ctx: 4096 } } },
      headers: { 'x-test-session': CONVERSATION.id }
    })
  })

  it('dispatches a realistic 4k summary with aligned input/output budgets', async () => {
    const { calls } = setupCompressor()
    const descriptor = await resolveCompressionModel('ollama::qwen3', CONVERSATION)
    const summary = await summarizeModelMessages(
      [
        { role: 'user', content: 'Remember the deadline is Friday and the budget is $500. '.repeat(20) },
        { role: 'assistant', content: 'I will preserve the deadline and budget in the plan.' }
      ],
      descriptor!.languageModel,
      resolveCompressionBudget(descriptor!.contextWindow!)
    )
    expect(summary).toBe('SUMMARY')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      maxOutputTokens: 1024,
      providerOptions: { ollama: { options: { num_ctx: 4096 } } }
    })
  })

  it('rejects an oversized summary before dispatch rather than returning a nonempty incomplete summary', async () => {
    const { doGenerate } = setupCompressor()
    const descriptor = await resolveCompressionModel('ollama::qwen3', CONVERSATION)
    await expect(
      generateText({
        model: descriptor!.languageModel,
        prompt: ' long history token'.repeat(10000),
        maxOutputTokens: 512,
        maxRetries: 0
      })
    ).rejects.toThrow(/summary prompt.*output reservation.*exceed/)
    expect(doGenerate).not.toHaveBeenCalled()
  })

  it('includes the summary output reservation in the final call capacity', async () => {
    const { doGenerate } = setupCompressor()
    const descriptor = await resolveCompressionModel('ollama::qwen3', CONVERSATION)
    await expect(
      generateText({
        model: descriptor!.languageModel,
        prompt: ' word'.repeat(1500),
        maxOutputTokens: 3800,
        maxRetries: 0
      })
    ).rejects.toThrow(/summary prompt.*output reservation.*exceed/)
    expect(doGenerate).not.toHaveBeenCalled()
  })
})
