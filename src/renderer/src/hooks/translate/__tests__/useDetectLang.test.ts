import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { mockUsePreference } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UNKNOWN } from '../../../config/translate'
import type { Chunk } from '../../../types/chunk'
import { ChunkType } from '../../../types/chunk'
import { detectLanguageByFranc, detectLanguageByLLM, detectWithMethod, useDetectLang } from '../useDetectLang'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `t(${key})` })
}))

vi.mock('i18next', () => ({
  default: { t: (key: string) => `t(${key})` }
}))

// Franc returns the iso3 code; we canonicalize per test via mockReturnValue.
const francMock = vi.fn<(input: string) => string>()
vi.mock('franc-min', () => ({
  franc: (input: string) => francMock(input)
}))

// LLM fetch stream — tests push their own chunks via mockImplementation.
const fetchChatCompletionMock = vi.fn<(args: { onChunkReceived: (c: Chunk) => void }) => Promise<void>>()
vi.mock('@renderer/services/ApiService', () => ({
  fetchChatCompletion: (args: any) => fetchChatCompletionMock(args)
}))

const getQuickModelMock = vi.fn()
const getDefaultAssistantMock = vi.fn(() => ({ model: undefined, settings: {}, prompt: '' }))
vi.mock('@renderer/services/AssistantService', () => ({
  getQuickModel: () => getQuickModelMock(),
  getDefaultAssistant: () => getDefaultAssistantMock()
}))

const hasModelMock = vi.fn()
vi.mock('@renderer/services/ModelService', () => ({
  hasModel: (m: any) => hasModelMock(m)
}))

const isQwenMTModelMock = vi.fn()
vi.mock('@renderer/config/models', () => ({
  isQwenMTModel: (m: any) => isQwenMTModelMock(m)
}))

// Token-count threshold: 100 in the hook. Tests drive the branch via this mock.
const estimateTextTokensMock = vi.fn()
vi.mock('@renderer/services/TokenService', () => ({
  estimateTextTokens: (text: string) => estimateTextTokensMock(text)
}))

vi.mock('tokenx', () => ({
  sliceByTokens: (text: string) => text
}))

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('detectLanguageByLLM', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Happy baseline: valid model, not Qwen-MT, LLM returns a valid code.
    getQuickModelMock.mockReturnValue({ id: 'gpt' })
    hasModelMock.mockReturnValue(true)
    isQwenMTModelMock.mockReturnValue(false)
    fetchChatCompletionMock.mockImplementation(async ({ onChunkReceived }) => {
      onChunkReceived({ type: ChunkType.TEXT_DELTA, text: 'en-us' } as Chunk)
    })
  })

  it('returns the trimmed lang code the LLM streams back', async () => {
    fetchChatCompletionMock.mockImplementationOnce(async ({ onChunkReceived }) => {
      onChunkReceived({ type: ChunkType.TEXT_DELTA, text: '  en-us  ' } as Chunk)
    })

    await expect(detectLanguageByLLM('Hello', ['en-us', 'zh-cn'])).resolves.toBe('en-us')
  })

  it('throws when getQuickModel returns nothing', async () => {
    getQuickModelMock.mockReturnValueOnce(undefined)
    await expect(detectLanguageByLLM('Hello', ['en-us'])).rejects.toThrow(/model/i)
  })

  it('throws when hasModel returns false', async () => {
    hasModelMock.mockReturnValueOnce(false)
    await expect(detectLanguageByLLM('Hello', ['en-us'])).rejects.toThrow(/model/i)
  })

  it('throws when the selected model is a Qwen-MT model', async () => {
    isQwenMTModelMock.mockReturnValueOnce(true)
    await expect(detectLanguageByLLM('Hello', ['en-us'])).rejects.toThrow(/qwen_mt/i)
  })

  it('throws when the LLM responds with an empty string', async () => {
    fetchChatCompletionMock.mockImplementationOnce(async ({ onChunkReceived }) => {
      onChunkReceived({ type: ChunkType.TEXT_DELTA, text: '   ' } as Chunk)
    })
    await expect(detectLanguageByLLM('Hello', ['en-us'])).rejects.toThrow(/empty/i)
  })

  it('throws when the LLM responds with an invalid lang code', async () => {
    fetchChatCompletionMock.mockImplementationOnce(async ({ onChunkReceived }) => {
      onChunkReceived({ type: ChunkType.TEXT_DELTA, text: 'NOT_A_CODE' } as Chunk)
    })
    await expect(detectLanguageByLLM('Hello', ['en-us'])).rejects.toThrow(/invalid/i)
  })
})

describe('detectLanguageByFranc', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps a recognized iso3 to its corresponding lang code', () => {
    francMock.mockReturnValueOnce('cmn')
    expect(detectLanguageByFranc('你好世界')).toBe('zh-cn')
  })

  it('returns UNKNOWN.langCode when the iso3 is not in the supported isoMap', () => {
    francMock.mockReturnValueOnce('xxx')
    expect(detectLanguageByFranc('???')).toBe(UNKNOWN.langCode)
  })
})

describe('detectWithMethod', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getQuickModelMock.mockReturnValue({ id: 'gpt' })
    hasModelMock.mockReturnValue(true)
    isQwenMTModelMock.mockReturnValue(false)
    fetchChatCompletionMock.mockImplementation(async ({ onChunkReceived }) => {
      onChunkReceived({ type: ChunkType.TEXT_DELTA, text: 'en-us' } as Chunk)
    })
  })

  it('auto + short text (< token threshold) routes to the LLM', async () => {
    estimateTextTokensMock.mockReturnValueOnce(10)
    await expect(detectWithMethod('Hi', 'auto', ['en-us'])).resolves.toBe('en-us')
    expect(fetchChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(francMock).not.toHaveBeenCalled()
  })

  it('auto + long text uses franc when franc resolves a known language', async () => {
    estimateTextTokensMock.mockReturnValueOnce(500)
    francMock.mockReturnValueOnce('jpn')
    await expect(detectWithMethod('日本語の長い文章…', 'auto', ['ja-jp'])).resolves.toBe('ja-jp')
    expect(fetchChatCompletionMock).not.toHaveBeenCalled()
  })

  it('auto + long text falls back to the LLM when franc returns UNKNOWN', async () => {
    estimateTextTokensMock.mockReturnValueOnce(500)
    francMock.mockReturnValueOnce('und') // not in isoMap
    await expect(detectWithMethod('gibberish text', 'auto', ['en-us'])).resolves.toBe('en-us')
    expect(fetchChatCompletionMock).toHaveBeenCalledTimes(1)
  })

  it('franc method goes through franc directly (no LLM)', async () => {
    francMock.mockReturnValueOnce('kor')
    await expect(detectWithMethod('안녕하세요', 'franc', ['ko-kr'])).resolves.toBe('ko-kr')
    expect(fetchChatCompletionMock).not.toHaveBeenCalled()
  })

  it('llm method always goes through the LLM (no franc)', async () => {
    await expect(detectWithMethod('Hi there', 'llm', ['en-us'])).resolves.toBe('en-us')
    expect(fetchChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(francMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Hook surface
// ---------------------------------------------------------------------------

describe('useDetectLang hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePreference.mockImplementation(() => ['llm', vi.fn()] as any)
    mockUseQuery.mockImplementation(
      () =>
        ({
          data: [
            { langCode: 'en-us', value: 'English', emoji: '🇺🇸' },
            { langCode: 'zh-cn', value: '中文', emoji: '🇨🇳' }
          ],
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn()
        }) as any
    )
    getQuickModelMock.mockReturnValue({ id: 'gpt' })
    hasModelMock.mockReturnValue(true)
    isQwenMTModelMock.mockReturnValue(false)
    fetchChatCompletionMock.mockImplementation(async ({ onChunkReceived }) => {
      onChunkReceived({ type: ChunkType.TEXT_DELTA, text: 'en-us' } as Chunk)
    })
  })

  it('returns UNKNOWN.langCode for empty/whitespace input without hitting detection', async () => {
    const { result } = renderHook(() => useDetectLang())

    const code = await act(async () => result.current('   '))
    expect(code).toBe(UNKNOWN.langCode)
    expect(fetchChatCompletionMock).not.toHaveBeenCalled()
    expect(francMock).not.toHaveBeenCalled()
  })

  it('returns UNKNOWN.langCode when the language list is empty', async () => {
    mockUseQuery.mockImplementation(
      () =>
        ({
          data: [],
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn()
        }) as any
    )

    const { result } = renderHook(() => useDetectLang())

    const code = await act(async () => result.current('Hello'))
    expect(code).toBe(UNKNOWN.langCode)
    expect(fetchChatCompletionMock).not.toHaveBeenCalled()
  })

  it('delegates to the method selected via usePreference (franc here)', async () => {
    mockUsePreference.mockImplementation(() => ['franc', vi.fn()] as any)
    francMock.mockReturnValueOnce('eng')

    const { result } = renderHook(() => useDetectLang())

    const code = await act(async () => result.current('Hello world'))
    expect(code).toBe('en-us')
    expect(francMock).toHaveBeenCalledWith('Hello world')
    expect(fetchChatCompletionMock).not.toHaveBeenCalled()
  })
})
