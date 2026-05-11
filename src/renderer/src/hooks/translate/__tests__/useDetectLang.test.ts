import { parseTranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { mockUsePreference } from '@test-mocks/renderer/usePreference'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UNKNOWN_LANG_CODE } from '../../../utils/translate'
import { detectLanguageByFranc, detectLanguageByLLM, detectWithMethod, useDetectLang } from '../useDetectLang'

const lang = parseTranslateLangCode

// Stand-in Model used everywhere the helper needs one. Shape only — never
// inspected by the assertions; what matters is whether the LLM path was hit.
const TEST_MODEL = { id: 'gpt', provider: 'openai' } as never

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

// LLM goes through window.api.ai.generateText now (Main IPC). Tests can drive
// the response per case via mockImplementation/mockResolvedValueOnce.
const generateTextMock =
  vi.fn<(args: { uniqueModelId: string; system?: string; prompt: string }) => Promise<{ text: string }>>()
vi.stubGlobal('window', {
  ...globalThis.window,
  api: { ai: { generateText: (args: any) => generateTextMock(args) } },
  toast: { error: vi.fn() }
})

const isQwenMTModelMock = vi.fn()
vi.mock('@renderer/config/models', () => ({
  isQwenMTModel: (m: any) => isQwenMTModelMock(m)
}))

// _bridge is exercised by the hook to convert v2 SharedModel → v1 Model; the
// pure helpers receive the v1-shaped Model directly so this mock only matters
// for the hook surface tests.
vi.mock('@renderer/config/models/_bridge', () => ({
  fromSharedModel: (m: any) => m
}))

const useDefaultModelMock = vi.fn(() => ({ quickModel: TEST_MODEL }))
vi.mock('@renderer/hooks/useModels', () => ({
  useDefaultModel: () => useDefaultModelMock()
}))

// Token-count threshold: 100 in the hook. Tests drive the branch via the
// tokenx estimateTokenCount mock.
const estimateTokenCountMock = vi.fn()
vi.mock('tokenx', () => ({
  estimateTokenCount: (text: string) => estimateTokenCountMock(text),
  sliceByTokens: (text: string) => text
}))

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('detectLanguageByLLM', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Happy baseline: valid model, not Qwen-MT, LLM returns a valid code.
    isQwenMTModelMock.mockReturnValue(false)
    generateTextMock.mockResolvedValue({ text: 'en-us' })
  })

  it('returns the trimmed lang code from window.api.ai.generateText', async () => {
    generateTextMock.mockResolvedValueOnce({ text: '  en-us  ' })

    await expect(detectLanguageByLLM('Hello', [lang('en-us'), lang('zh-cn')], TEST_MODEL)).resolves.toBe('en-us')
  })

  it('throws when no model is supplied', async () => {
    await expect(detectLanguageByLLM('Hello', [lang('en-us')], undefined)).rejects.toThrow(/model/i)
  })

  it('throws when the selected model is a Qwen-MT model', async () => {
    isQwenMTModelMock.mockReturnValueOnce(true)
    await expect(detectLanguageByLLM('Hello', [lang('en-us')], TEST_MODEL)).rejects.toThrow(/qwen_mt/i)
  })

  it('throws when the LLM responds with an empty string', async () => {
    generateTextMock.mockResolvedValueOnce({ text: '   ' })
    await expect(detectLanguageByLLM('Hello', [lang('en-us')], TEST_MODEL)).rejects.toThrow(/empty/i)
  })

  it('throws when the LLM responds with an invalid lang code', async () => {
    generateTextMock.mockResolvedValueOnce({ text: 'NOT_A_CODE' })
    await expect(detectLanguageByLLM('Hello', [lang('en-us')], TEST_MODEL)).rejects.toThrow(/invalid/i)
  })

  it('rejects when the IPC call itself rejects (no silent fallback to "empty")', async () => {
    generateTextMock.mockRejectedValueOnce(new Error('rate limited'))
    await expect(detectLanguageByLLM('Hello', [lang('en-us')], TEST_MODEL)).rejects.toThrow(/rate limited/i)
  })
})

describe('detectLanguageByFranc', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps a recognized iso3 to its corresponding lang code', () => {
    francMock.mockReturnValueOnce('cmn')
    expect(detectLanguageByFranc('你好世界')).toBe('zh-cn')
  })

  it('returns the unknown lang code and logs a debug when the iso3 is not in the supported isoMap', () => {
    francMock.mockReturnValueOnce('xxx')
    const debugSpy = vi.spyOn(mockRendererLoggerService, 'debug').mockImplementation(() => {})

    expect(detectLanguageByFranc('???')).toBe(UNKNOWN_LANG_CODE)
    expect(debugSpy).toHaveBeenCalledWith('franc iso3 not in isoMap, falling back to UNKNOWN', { iso3: 'xxx' })
  })
})

describe('detectWithMethod', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isQwenMTModelMock.mockReturnValue(false)
    generateTextMock.mockResolvedValue({ text: 'en-us' })
  })

  it('auto + short text (< token threshold) routes to the LLM', async () => {
    estimateTokenCountMock.mockReturnValueOnce(10)
    await expect(detectWithMethod('Hi', 'auto', [lang('en-us')], TEST_MODEL)).resolves.toBe('en-us')
    expect(generateTextMock).toHaveBeenCalledTimes(1)
    expect(francMock).not.toHaveBeenCalled()
  })

  it('auto + long text uses franc when franc resolves a known language', async () => {
    estimateTokenCountMock.mockReturnValueOnce(500)
    francMock.mockReturnValueOnce('jpn')
    await expect(detectWithMethod('日本語の長い文章…', 'auto', [lang('ja-jp')], TEST_MODEL)).resolves.toBe('ja-jp')
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('auto + long text falls back to the LLM when franc returns UNKNOWN (logs the fallback)', async () => {
    estimateTokenCountMock.mockReturnValueOnce(500)
    francMock.mockReturnValueOnce('und') // not in isoMap
    const infoSpy = vi.spyOn(mockRendererLoggerService, 'info').mockImplementation(() => {})

    await expect(detectWithMethod('gibberish text', 'auto', [lang('en-us')], TEST_MODEL)).resolves.toBe('en-us')
    expect(generateTextMock).toHaveBeenCalledTimes(1)
    expect(infoSpy).toHaveBeenCalledWith('franc returned UNKNOWN, falling back to LLM detection')
  })

  it('franc method goes through franc directly (no LLM)', async () => {
    francMock.mockReturnValueOnce('kor')
    await expect(detectWithMethod('안녕하세요', 'franc', [lang('ko-kr')], TEST_MODEL)).resolves.toBe('ko-kr')
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('llm method always goes through the LLM (no franc)', async () => {
    await expect(detectWithMethod('Hi there', 'llm', [lang('en-us')], TEST_MODEL)).resolves.toBe('en-us')
    expect(generateTextMock).toHaveBeenCalledTimes(1)
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
            { langCode: lang('en-us'), value: 'English', emoji: '🇺🇸' },
            { langCode: lang('zh-cn'), value: '中文', emoji: '🇨🇳' }
          ],
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn()
        }) as any
    )
    useDefaultModelMock.mockReturnValue({ quickModel: TEST_MODEL })
    isQwenMTModelMock.mockReturnValue(false)
    generateTextMock.mockResolvedValue({ text: 'en-us' })
  })

  it('returns the unknown lang code for empty/whitespace input without hitting detection', async () => {
    const { result } = renderHook(() => useDetectLang())

    const code = await act(async () => result.current('   '))
    expect(code).toBe(UNKNOWN_LANG_CODE)
    expect(generateTextMock).not.toHaveBeenCalled()
    expect(francMock).not.toHaveBeenCalled()
  })

  it('returns the unknown lang code when languages are still loading (undefined) and logs a warn', async () => {
    mockUseQuery.mockImplementation(
      () =>
        ({
          data: undefined,
          isLoading: true,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn()
        }) as any
    )
    const warnSpy = vi.spyOn(mockRendererLoggerService, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useDetectLang())

    const code = await act(async () => result.current('Hello'))
    expect(code).toBe(UNKNOWN_LANG_CODE)
    expect(generateTextMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('useDetectLang invoked before languages were ready, returning UNKNOWN')
  })

  it('returns the unknown lang code when the language list resolved to an empty array and logs an error', async () => {
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
    const errorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useDetectLang())

    const code = await act(async () => result.current('Hello'))
    expect(code).toBe(UNKNOWN_LANG_CODE)
    expect(generateTextMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith('useDetectLang invoked with an empty language list')
  })

  it('delegates to the method selected via usePreference (franc here)', async () => {
    mockUsePreference.mockImplementation(() => ['franc', vi.fn()] as any)
    francMock.mockReturnValueOnce('eng')

    const { result } = renderHook(() => useDetectLang())

    const code = await act(async () => result.current('Hello world'))
    expect(code).toBe('en-us')
    expect(francMock).toHaveBeenCalledWith('Hello world')
    expect(generateTextMock).not.toHaveBeenCalled()
  })
})
