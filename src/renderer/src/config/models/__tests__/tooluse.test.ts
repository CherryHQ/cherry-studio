import type { Model } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isEmbeddingModel, isRerankModel } from '../embedding'
import { isDeepSeekHybridInferenceModel } from '../reasoning'
import { isFunctionCallingModel } from '../tooluse'
import { isPureGenerateImageModel, isTextToImageModel } from '../vision'

vi.mock('@renderer/hooks/useStore', () => ({
  getStoreProviders: vi.fn(() => [])
}))

vi.mock('@renderer/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({
      llm: { providers: [] },
      settings: {}
    })
  },
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn()
}))

vi.mock('@renderer/store/settings', () => {
  const noop = vi.fn()
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'initialState') {
          return {}
        }
        return noop
      }
    }
  )
})

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: vi.fn(() => ({})),
  useNavbarPosition: vi.fn(() => ({ navbarPosition: 'left' })),
  useMessageStyle: vi.fn(() => ({ isBubbleStyle: false })),
  getStoreSetting: vi.fn()
}))

vi.mock('../embedding', () => ({
  isEmbeddingModel: vi.fn(),
  isRerankModel: vi.fn()
}))

vi.mock('../vision', () => ({
  isPureGenerateImageModel: vi.fn(),
  isTextToImageModel: vi.fn()
}))

vi.mock('../reasoning', () => ({
  isDeepSeekHybridInferenceModel: vi.fn()
}))

const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'gpt-4o',
  name: 'gpt-4o',
  provider: 'openai',
  group: 'OpenAI',
  ...overrides
})

const embeddingMock = vi.mocked(isEmbeddingModel)
const rerankMock = vi.mocked(isRerankModel)
const pureImageMock = vi.mocked(isPureGenerateImageModel)
const textToImageMock = vi.mocked(isTextToImageModel)
const deepSeekHybridMock = vi.mocked(isDeepSeekHybridInferenceModel)

describe('isFunctionCallingModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    embeddingMock.mockReturnValue(false)
    rerankMock.mockReturnValue(false)
    pureImageMock.mockReturnValue(false)
    textToImageMock.mockReturnValue(false)
    deepSeekHybridMock.mockReturnValue(false)
  })

  it('returns false when the model is undefined', () => {
    expect(isFunctionCallingModel(undefined as unknown as Model)).toBe(false)
  })

  it('returns false when model is classified as embedding/rerank/image', () => {
    embeddingMock.mockReturnValueOnce(true)
    expect(isFunctionCallingModel(createModel())).toBe(false)
  })

  it('respect manual user overrides', () => {
    const model = createModel({
      capabilities: [{ type: 'function_calling', isUserSelected: false }]
    })
    expect(isFunctionCallingModel(model)).toBe(false)
    const enabled = createModel({
      capabilities: [{ type: 'function_calling', isUserSelected: true }]
    })
    expect(isFunctionCallingModel(enabled)).toBe(true)
  })

  it('matches doubao models by name when regex applies', () => {
    const doubao = createModel({
      id: 'custom-model',
      name: 'Doubao-Seed-1.6-251015',
      provider: 'doubao'
    })
    expect(isFunctionCallingModel(doubao)).toBe(true)
  })

  it('returns true for regex matches on standard providers', () => {
    expect(isFunctionCallingModel(createModel({ id: 'gpt-5' }))).toBe(true)
  })

  it('excludes explicitly blocked ids', () => {
    expect(isFunctionCallingModel(createModel({ id: 'gemini-1.5-flash' }))).toBe(false)
    expect(isFunctionCallingModel(createModel({ id: 'deepseek-v3.2-speciale' }))).toBe(false)
    expect(isFunctionCallingModel(createModel({ id: 'deepseek/deepseek-v3.2-speciale' }))).toBe(false)
  })

  it('returns true when identified as deepseek hybrid inference model', () => {
    deepSeekHybridMock.mockReturnValueOnce(true)
    expect(isFunctionCallingModel(createModel({ id: 'deepseek-v3-1', provider: 'custom' }))).toBe(true)
  })

  it('returns false for deepseek hybrid models behind restricted system providers', () => {
    deepSeekHybridMock.mockReturnValueOnce(true)
    expect(isFunctionCallingModel(createModel({ id: 'deepseek-v3-1', provider: 'dashscope' }))).toBe(false)
  })

  it('supports anthropic models through claude regex match', () => {
    expect(isFunctionCallingModel(createModel({ id: 'claude-3-5-sonnet', provider: 'anthropic' }))).toBe(true)
    expect(isFunctionCallingModel(createModel({ id: 'claude-3-opus', provider: 'anthropic' }))).toBe(true)
  })

  it('supports kimi models through kimi-k2 regex match', () => {
    expect(isFunctionCallingModel(createModel({ id: 'kimi-k2-0711-preview', provider: 'moonshot' }))).toBe(true)
    expect(isFunctionCallingModel(createModel({ id: 'kimi-k2', provider: 'kimi' }))).toBe(true)
  })

  it('supports deepseek models through deepseek regex match', () => {
    expect(isFunctionCallingModel(createModel({ id: 'deepseek-chat', provider: 'deepseek' }))).toBe(true)
    expect(isFunctionCallingModel(createModel({ id: 'deepseek-coder', provider: 'deepseek' }))).toBe(true)
  })
})
