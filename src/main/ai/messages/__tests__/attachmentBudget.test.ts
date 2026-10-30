import os from 'node:os'

import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveOllamaRequestNumCtx } from '@main/ai/utils/ollamaRequestNumCtx'
import { READ_FILE_PAGE_SIZE } from '@shared/ai/builtinTools'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import { makeModel, makeProvider } from '../../__tests__/fixtures'
import {
  allocateAttachmentBudget,
  allocateInlineCaps,
  buildFallbackOllamaNumCtxSnapshots,
  resolveAttachmentBudgetContextWindow,
  isFallbackCallWithinWindow
} from '../attachmentBudget'

vi.mock('node:os', () => ({
  default: { freemem: () => 8 * 1024 ** 3, totalmem: () => 16 * 1024 ** 3, homedir: () => 'C:\\Users\\test' }
}))

const { mockGetProviderById, mockGetModelByKey, mockBudgetWarn } = vi.hoisted(() => ({
  mockBudgetWarn: vi.fn(),
  mockGetProviderById: vi.fn(),
  mockGetModelByKey: vi.fn()
}))

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: mockBudgetWarn }) } }))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: mockGetProviderById }
}))

vi.mock('@main/data/services/ModelService', () => ({
  modelService: { getByKey: mockGetModelByKey }
}))

/** One token per character, so allocations read directly as character counts. */
const charTokenizer = { id: 'chars', count: (text: string) => text.length }
const budgetOf = (tokens: number) => ({ tokens, tokenizer: charTokenizer })

vi.mock('@main/ai/tokens/profiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@main/ai/tokens/profiles')>()),
  getTextTokenizer: async () => charTokenizer
}))

describe('allocateAttachmentBudget', () => {
  // The defect this replaces: the cap was `max(READ_FILE_PAGE_SIZE, share)` per
  // file, so N attachments inlined N × 8000 no matter how small the share was.
  it('never exceeds the total, however many files ask for a share', () => {
    const sizes = new Array(1_000).fill(500_000)
    const allocated = allocateAttachmentBudget(sizes, 100_000)

    expect(sum(allocated)).toBeLessThanOrEqual(100_000)
    expect(sum(allocated)).toBeGreaterThan(0)
    expect(1_000 * READ_FILE_PAGE_SIZE).toBeGreaterThan(100_000) // the old floor would have blown it
  })

  // An equal split would truncate the big file at half the pool while the small
  // one leaves its half unused.
  it('serves small files whole and gives the rest to the large ones', () => {
    expect(allocateAttachmentBudget([10, 1_000], 100)).toEqual([10, 90])
  })

  it('leaves the pool alone when everything fits', () => {
    expect(allocateAttachmentBudget([10, 20], 1_000)).toEqual([10, 20])
  })

  it('allocates nothing rather than throwing on an exhausted or absent pool', () => {
    expect(allocateAttachmentBudget([100, 200], 0)).toEqual([0, 0])
    expect(allocateAttachmentBudget([100], -5)).toEqual([0])
    expect(allocateAttachmentBudget([], 100)).toEqual([])
  })
})

describe('allocateInlineCaps', () => {
  it('caps each body within the shared pool', () => {
    const caps = allocateInlineCaps(['a'.repeat(50), 'b'.repeat(50)], budgetOf(60))

    expect(caps).toEqual([30, 30])
  })

  // A cap in tokens has to become a cut point in characters, and the two differ
  // per script — CJK runs ~1 char/token where English runs ~4.
  it('converts a token cap using each body own measured ratio', () => {
    const twoCharsPerToken = { id: 'halves', count: (text: string) => Math.ceil(text.length / 2) }
    const [cap] = allocateInlineCaps(['x'.repeat(100)], { tokens: 10, tokenizer: twoCharsPerToken })

    expect(cap).toBe(20)
  })

  // Density is not uniform inside one attachment. Scaling by the body's average
  // chars-per-token overshot on a dense head: a 100-CJK/400-ASCII body averages
  // 2.5 chars/token, so a 50-token cap kept 125 chars — really 107 tokens. The
  // pool's ceiling then failed to hold for mixed-language and code attachments.
  it('cuts by measured prefix cost, not by the body average density', () => {
    const mixed = {
      id: 'mixed',
      count: (t: string) => Math.ceil([...t].reduce((n, c) => n + (c > '\u007f' ? 1 : 0.25), 0))
    }
    const body = '一'.repeat(100) + 'a'.repeat(400)

    const [cap] = allocateInlineCaps([body], { tokens: 50, tokenizer: mixed })

    expect(mixed.count(body.slice(0, cap))).toBeLessThanOrEqual(50)
  })

  // The property the whole pool exists for: whatever the scripts involved, the
  // sum of what is actually inlined stays inside the budget.
  it('keeps the total inlined cost within the pool for mixed-density bodies', () => {
    const mixed = {
      id: 'mixed',
      count: (t: string) => Math.ceil([...t].reduce((n, c) => n + (c > '\u007f' ? 1 : 0.25), 0))
    }
    const bodies = ['一'.repeat(200) + 'b'.repeat(800), 'c'.repeat(2_000), '文'.repeat(300)]
    const pool = 120

    const caps = allocateInlineCaps(bodies, { tokens: pool, tokenizer: mixed })
    const spent = bodies.reduce((sum, body, i) => sum + mixed.count(body.slice(0, caps[i])), 0)

    expect(spent).toBeLessThanOrEqual(pool)
  })

  it('does not cut a body that fits', () => {
    expect(allocateInlineCaps(['short'], budgetOf(1_000))).toEqual([5])
  })

  it('survives an empty body without dividing by zero', () => {
    expect(allocateInlineCaps([''], budgetOf(0))).toEqual([0])
  })
})

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

describe('resolveAttachmentBudgetContextWindow', () => {
  beforeEach(() => {
    mockGetProviderById.mockReset()
    mockGetModelByKey.mockReset()
  })

  it('budgets against the smallest window among configured fallbacks', () => {
    const primaryProvider = makeProvider({ id: 'openai', presetProviderId: 'openai' })
    const primaryModel = makeModel({
      id: 'openai::gpt-4',
      providerId: 'openai',
      contextWindow: 131_072
    })
    const fallbackUniqueId = createUniqueModelId('ollama', 'qwen3')
    const fallbackProvider = makeProvider({
      id: 'ollama',
      presetProviderId: 'ollama',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'ollama' } }
    })
    const fallbackModel = makeModel({
      id: fallbackUniqueId,
      providerId: 'ollama',
      apiModelId: 'qwen3',
      contextWindow: 131_072
    })

    mockGetProviderById.mockImplementation((providerId: string) => {
      if (providerId === 'ollama') return fallbackProvider
      throw new Error(`unknown provider ${providerId}`)
    })
    mockGetModelByKey.mockImplementation((providerId: string, modelId: string) => {
      if (providerId === 'ollama' && modelId === 'qwen3') return fallbackModel
      throw new Error(`unknown model ${providerId}/${modelId}`)
    })

    expect(
      resolveAttachmentBudgetContextWindow({
        provider: primaryProvider,
        model: primaryModel,
        fallbackModelIds: []
      })
    ).toBe(131_072)

    const fallbackSnapshots = new Map([
      [
        fallbackUniqueId,
        {
          uniqueModelId: fallbackUniqueId,
          trainedContextWindow: 131_072,
          numCtx: 32_768
        }
      ]
    ])

    expect(
      resolveAttachmentBudgetContextWindow({
        provider: primaryProvider,
        model: primaryModel,
        fallbackModelIds: [fallbackUniqueId],
        fallbackOllamaSnapshots: fallbackSnapshots
      })
    ).toBe(32_768)
  })

  it('uses frozen fallback snapshots instead of re-sampling Ollama RAM', () => {
    const primaryProvider = makeProvider({ id: 'openai', presetProviderId: 'openai' })
    const primaryModel = makeModel({
      id: 'openai::gpt-4',
      providerId: 'openai',
      contextWindow: 131_072
    })
    const fallbackUniqueId = createUniqueModelId('ollama', 'qwen3')
    const fallbackProvider = makeProvider({
      id: 'ollama',
      presetProviderId: 'ollama',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'ollama' } }
    })
    const fallbackModel = makeModel({
      id: fallbackUniqueId,
      providerId: 'ollama',
      apiModelId: 'qwen3',
      contextWindow: 131_072
    })

    mockGetProviderById.mockImplementation((providerId: string) => {
      if (providerId === 'ollama') return fallbackProvider
      throw new Error(`unknown provider ${providerId}`)
    })
    mockGetModelByKey.mockImplementation((providerId: string, modelId: string) => {
      if (providerId === 'ollama' && modelId === 'qwen3') return fallbackModel
      throw new Error(`unknown model ${providerId}/${modelId}`)
    })

    const frozenCap = 16_384
    const fallbackSnapshots = new Map([
      [
        fallbackUniqueId,
        {
          uniqueModelId: fallbackUniqueId,
          trainedContextWindow: 131_072,
          numCtx: frozenCap
        }
      ]
    ])

    expect(
      resolveAttachmentBudgetContextWindow({
        provider: primaryProvider,
        model: primaryModel,
        fallbackModelIds: [fallbackUniqueId],
        fallbackOllamaSnapshots: fallbackSnapshots
      })
    ).toBe(frozenCap)
  })

  it('ignores request-incompatible fallbacks when budgeting attachment context', () => {
    const primaryProvider = makeProvider({ id: 'openai', presetProviderId: 'openai' })
    const primaryModel = makeModel({
      id: 'openai::gpt-4-vision',
      providerId: 'openai',
      contextWindow: 131_072,
      capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION]
    })
    const fallbackUniqueId = createUniqueModelId('openai', 'gpt-4-mini')
    const fallbackProvider = makeProvider({ id: 'openai', presetProviderId: 'openai' })
    const textOnlyFallback = makeModel({
      id: fallbackUniqueId,
      providerId: 'openai',
      apiModelId: 'gpt-4-mini',
      contextWindow: 8_192
    })

    mockGetProviderById.mockReturnValue(fallbackProvider)
    mockGetModelByKey.mockImplementation((providerId: string, modelId: string) => {
      if (providerId === 'openai' && modelId === 'gpt-4-mini') return textOnlyFallback
      throw new Error(`unknown model ${providerId}/${modelId}`)
    })

    expect(
      resolveAttachmentBudgetContextWindow({
        provider: primaryProvider,
        model: primaryModel,
        fallbackModelIds: [fallbackUniqueId],
        primaryHasTools: false,
        requiredNativeFileSupport: { image: true, pdf: false, audio: false, video: false }
      })
    ).toBe(131_072)
  })

  it('ignores disabled fallback providers when budgeting attachment context', () => {
    const primaryProvider = makeProvider({ id: 'openai', presetProviderId: 'openai' })
    const primaryModel = makeModel({
      id: 'openai::gpt-4',
      providerId: 'openai',
      contextWindow: 131_072
    })
    const fallbackUniqueId = createUniqueModelId('ollama', 'tiny')
    const disabledFallbackProvider = makeProvider({
      id: 'ollama',
      presetProviderId: 'ollama',
      isEnabled: false,
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'ollama' } }
    })
    const tinyFallbackModel = makeModel({
      id: fallbackUniqueId,
      providerId: 'ollama',
      apiModelId: 'tiny',
      contextWindow: 8_192
    })

    mockGetProviderById.mockImplementation((providerId: string) => {
      if (providerId === 'ollama') return disabledFallbackProvider
      throw new Error(`unknown provider ${providerId}`)
    })
    mockGetModelByKey.mockImplementation((providerId: string, modelId: string) => {
      if (providerId === 'ollama' && modelId === 'tiny') return tinyFallbackModel
      throw new Error(`unknown model ${providerId}/${modelId}`)
    })

    expect(
      resolveAttachmentBudgetContextWindow({
        provider: primaryProvider,
        model: primaryModel,
        fallbackModelIds: [fallbackUniqueId]
      })
    ).toBe(131_072)
  })

  // The gate this guards: without the resolved PDF check, a fallback retry
  // execution would later reject (it cannot take the file part) still shrank
  // the primary's attachment pool to its window.
  it('ignores pdf-ineligible fallbacks when the request needs native pdf input', () => {
    const primaryProvider = makeProvider({ id: 'openai', presetProviderId: 'openai' })
    const primaryModel = makeModel({ id: 'openai::gpt-4', providerId: 'openai', contextWindow: 131_072 })
    const fallbackUniqueId = createUniqueModelId('ollama', 'qwen3')
    const fallbackProvider = makeProvider({
      id: 'ollama',
      presetProviderId: 'ollama',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'ollama' } }
    })
    const fallbackModel = makeModel({
      id: fallbackUniqueId,
      providerId: 'ollama',
      apiModelId: 'qwen3',
      contextWindow: 8_192
    })

    mockGetProviderById.mockImplementation((providerId: string) => {
      if (providerId === 'ollama') return fallbackProvider
      throw new Error(`unknown provider ${providerId}`)
    })
    mockGetModelByKey.mockImplementation((providerId: string, modelId: string) => {
      if (providerId === 'ollama' && modelId === 'qwen3') return fallbackModel
      throw new Error(`unknown model ${providerId}/${modelId}`)
    })

    expect(
      resolveAttachmentBudgetContextWindow({
        provider: primaryProvider,
        model: primaryModel,
        fallbackModelIds: [fallbackUniqueId],
        primaryHasTools: false,
        requiredNativeFileSupport: { image: false, pdf: true, audio: false, video: false }
      })
    ).toBe(131_072)
  })

  it('still constrains the budget with a pdf-eligible small fallback', () => {
    const primaryProvider = makeProvider({ id: 'openai', presetProviderId: 'openai' })
    const primaryModel = makeModel({ id: 'openai::gpt-4', providerId: 'openai', contextWindow: 131_072 })
    const fallbackUniqueId = createUniqueModelId('google', 'gemini-2.5-flash')
    const fallbackProvider = makeProvider({
      id: 'google',
      presetProviderId: 'google',
      endpointConfigs: { [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { adapterFamily: 'google' } }
    })
    const fallbackModel = makeModel({
      id: fallbackUniqueId,
      providerId: 'google',
      apiModelId: 'gemini-2.5-flash',
      contextWindow: 8_192,
      endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]
    })

    mockGetProviderById.mockImplementation((providerId: string) => {
      if (providerId === 'google') return fallbackProvider
      throw new Error(`unknown provider ${providerId}`)
    })
    mockGetModelByKey.mockImplementation((providerId: string, modelId: string) => {
      if (providerId === 'google' && modelId === 'gemini-2.5-flash') return fallbackModel
      throw new Error(`unknown model ${providerId}/${modelId}`)
    })

    expect(
      resolveAttachmentBudgetContextWindow({
        provider: primaryProvider,
        model: primaryModel,
        fallbackModelIds: [fallbackUniqueId],
        primaryHasTools: false,
        requiredNativeFileSupport: { image: false, pdf: true, audio: false, video: false }
      })
    ).toBe(8_192)
  })
})

describe('buildFallbackOllamaNumCtxSnapshots', () => {
  beforeEach(() => {
    mockGetProviderById.mockReset()
    mockGetModelByKey.mockReset()
  })

  /** The Ollama fallback fixtures the window tests above use. */
  function mockOllamaFallback(): UniqueModelId {
    const fallbackUniqueId = createUniqueModelId('ollama', 'qwen3')
    mockGetProviderById.mockImplementation((providerId: string) => {
      if (providerId === 'ollama') {
        return makeProvider({
          id: 'ollama',
          presetProviderId: 'ollama',
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
          endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'ollama' } }
        })
      }
      throw new Error(`unknown provider ${providerId}`)
    })
    mockGetModelByKey.mockImplementation((providerId: string, modelId: string) => {
      if (providerId === 'ollama' && modelId === 'qwen3') {
        return makeModel({ id: fallbackUniqueId, providerId: 'ollama', apiModelId: 'qwen3', contextWindow: 131_072 })
      }
      throw new Error(`unknown model ${providerId}/${modelId}`)
    })
    return fallbackUniqueId
  }

  it('does not re-sample the active model as a redundant fallback across a RAM threshold', () => {
    const activeId = mockOllamaFallback()
    const provider = mockGetProviderById('ollama')
    const model = mockGetModelByKey('ollama', 'qwen3')
    const free = vi.spyOn(os, 'freemem').mockReturnValue(12_600_000_000)
    const total = vi.spyOn(os, 'totalmem').mockReturnValue(32_000_000_000)
    try {
      const primary = resolveOllamaRequestNumCtx(model, provider, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)!
      expect(primary.numCtx).toBe(65_536)
      const primarySnapshot = {
        uniqueModelId: activeId,
        trainedContextWindow: primary.trainedContextWindow,
        numCtx: primary.numCtx
      }
      free.mockReturnValue(12_580_000_000)
      free.mockClear()
      const snapshots = buildFallbackOllamaNumCtxSnapshots([activeId], activeId)
      expect([...snapshots]).toEqual([])
      expect(
        resolveAttachmentBudgetContextWindow({
          provider,
          model,
          ollamaNumCtx: primarySnapshot,
          fallbackModelIds: [activeId],
          fallbackOllamaSnapshots: snapshots
        })
      ).toBe(65_536)
      expect(
        resolveAttachmentBudgetContextWindow({
          provider,
          model,
          ollamaNumCtx: primarySnapshot,
          fallbackModelIds: [activeId],
          fallbackOllamaSnapshots: new Map([[activeId, { ...primarySnapshot, numCtx: 32768 }]])
        })
      ).toBe(65_536)
      expect(free).not.toHaveBeenCalled()
    } finally {
      free.mockRestore()
      total.mockRestore()
    }
  })

  it('skips a pdf-ineligible ollama fallback when the request needs native pdf input', () => {
    const fallbackUniqueId = mockOllamaFallback()

    const snapshots = buildFallbackOllamaNumCtxSnapshots([fallbackUniqueId], createUniqueModelId('other', 'primary'), {
      primaryHasTools: false,
      requiredNativeFileSupport: { image: false, pdf: true, audio: false, video: false }
    })

    // The relay adapter resolves `openai-compatible`, outside the first-party
    // PDF set: retry would reject it after resolution, so nothing is frozen.
    expect([...snapshots.keys()]).toEqual([])
  })

  it('freezes the memory-capped window for a dispatchable ollama fallback', () => {
    const fallbackUniqueId = mockOllamaFallback()

    const snapshots = buildFallbackOllamaNumCtxSnapshots([fallbackUniqueId], createUniqueModelId('other', 'primary'), {
      primaryHasTools: false,
      requiredNativeFileSupport: { image: false, pdf: false, audio: false, video: false }
    })

    expect([...snapshots]).toEqual([
      [fallbackUniqueId, { uniqueModelId: fallbackUniqueId, trainedContextWindow: 131_072, numCtx: 32_768 }]
    ])
  })
})

describe('actual SDK fallback capacity', () => {
  it('keeps unknown/pricing-failure policy and logs only a fixed warning', async () => {
    mockBudgetWarn.mockClear()
    const provider = makeProvider({ id: 'openai' })
    expect(
      await isFallbackCallWithinWindow({
        call: { prompt: [] },
        fallbackProvider: provider,
        fallbackModel: makeModel({ contextWindow: null })
      })
    ).toBe(true)
    expect(mockBudgetWarn).not.toHaveBeenCalled()
    const call = {
      get prompt() {
        throw new Error('private payload must not be logged')
      }
    } as LanguageModelV3CallOptions
    expect(
      await isFallbackCallWithinWindow({
        call,
        fallbackProvider: provider,
        fallbackModel: makeModel({ contextWindow: 1000 })
      })
    ).toBe(true)
    expect(mockBudgetWarn).toHaveBeenCalledExactlyOnceWith(
      'Fallback call capacity could not be priced; allowing dispatch'
    )
  })

  it('prices prompt-only calls, system, later tool results, retained schemas and output reservation', async () => {
    const provider = makeProvider({ id: 'openai' })
    const model = makeModel({ id: 'openai::small', providerId: 'openai', contextWindow: 1000 })
    const check = (call: LanguageModelV3CallOptions) =>
      isFallbackCallWithinWindow({ call, fallbackProvider: provider, fallbackModel: model })
    const prompt: LanguageModelV3CallOptions['prompt'] = [
      { role: 'user', content: [{ type: 'text', text: 'x'.repeat(500) }] }
    ]
    expect(await check({ prompt })).toBe(true)
    expect(await check({ prompt, maxOutputTokens: 800 })).toBe(false)
    expect(await check({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(4000) }] }] })).toBe(false)
    expect(await check({ prompt: [...prompt, { role: 'system', content: 'x'.repeat(4000) }] })).toBe(false)
    expect(
      await check({
        prompt: [
          ...prompt,
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolName: 'read',
                toolCallId: '1',
                output: { type: 'text', value: 'x'.repeat(4000) }
              }
            ]
          }
        ]
      })
    ).toBe(false)
    expect(
      await check({
        prompt,
        tools: [{ type: 'function', name: 'read', inputSchema: { description: 'x'.repeat(4000) } }]
      })
    ).toBe(false)
  })
})

describe('resolved audio/video fallback budget parity', () => {
  it.each([
    ['audio', ENDPOINT_TYPE.OPENAI_RESPONSES, MODEL_CAPABILITY.AUDIO_RECOGNITION],
    ['video', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, MODEL_CAPABILITY.VIDEO_RECOGNITION]
  ] as const)(
    'does not shrink primary budget for converter-incompatible native %s',
    (modality, endpoint, capability) => {
      const provider = makeProvider({ id: 'google', presetProviderId: 'google' })
      const model = makeModel({ id: 'google::large', providerId: 'google', contextWindow: 131072 })
      const fallback = makeProvider({
        id: 'openai',
        defaultChatEndpoint: endpoint,
        endpointConfigs: { [endpoint]: { adapterFamily: 'openai' } }
      })
      const small = makeModel({
        id: 'openai::small',
        providerId: 'openai',
        contextWindow: 8192,
        capabilities: [capability],
        endpointTypes: [endpoint]
      })
      mockGetProviderById.mockReturnValue(fallback)
      mockGetModelByKey.mockReturnValue(small)
      expect(
        resolveAttachmentBudgetContextWindow({
          provider,
          model,
          fallbackModelIds: [createUniqueModelId('openai', 'small')],
          primaryHasTools: false,
          requiredNativeFileSupport: {
            image: false,
            pdf: false,
            audio: modality === 'audio',
            video: modality === 'video'
          }
        })
      ).toBe(131072)
    }
  )
})
