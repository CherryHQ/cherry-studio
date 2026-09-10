import type { TranslateLanguage } from '@shared/data/types/translate'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateTextMock =
  vi.fn<
    (request: { system?: string; reasoningEffort?: string; requestOptions?: { signal?: AbortSignal } }) => Promise<{
      text: string
    }>
  >()

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiService: { generateText: generateTextMock }
  } as never)
})

const getByKeyMock = vi.fn()
vi.mock('@main/data/services/ModelService', () => ({
  modelService: { getByKey: getByKeyMock }
}))

const listMock = vi.fn<() => TranslateLanguage[]>()
vi.mock('@main/data/services/TranslateLanguageService', () => ({
  translateLanguageService: { list: listMock }
}))

const francMock = vi.fn<(input: string) => string>()
vi.mock('franc-min', () => ({ franc: (input: string) => francMock(input) }))

const estimateTokenCountMock = vi.fn<(text: string) => number>()
vi.mock('tokenx', () => ({
  estimateTokenCount: (text: string) => estimateTokenCountMock(text),
  sliceByTokens: (text: string) => text
}))

const { makeModel } = await import('../../../ai/__tests__/fixtures')
const { detectLanguageOrUnknown } = await import('../detectLanguage')

/**
 * Why detection gave up. Nothing surfaces these to a user — every entry point degrades — so the
 * log is where a cause is observable, and asserting it is what keeps the causes distinguishable.
 */
const lastFailure = (): Error => {
  const call = mockMainLoggerService.warn.mock.calls.at(-1)
  if (!call) throw new Error('no detection failure was logged')
  return (call[1] as { error: Error }).error
}

const language = (langCode: string): TranslateLanguage =>
  ({ langCode, value: langCode, emoji: '🏳️' }) as unknown as TranslateLanguage

const LANGUAGES = [language('en-us'), language('zh-cn')]

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.auto_detection_method', 'llm')
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.quick_assistant.model_id', 'openai::gpt-4.1')
  listMock.mockReset().mockReturnValue(LANGUAGES)
  getByKeyMock.mockReset().mockImplementation(() => makeModel({}))
  francMock.mockReset()
  estimateTokenCountMock.mockReset().mockReturnValue(10)
  generateTextMock.mockReset().mockResolvedValue({ text: 'en-us' })
  mockMainLoggerService.warn.mockClear()
})

describe('detectLanguageOrUnknown', () => {
  describe('llm method', () => {
    it('returns the trimmed lang code the model replied with', async () => {
      generateTextMock.mockResolvedValueOnce({ text: '  en-us  ' })

      await expect(detectLanguageOrUnknown('Hello')).resolves.toBe('en-us')
    })

    it("hands the caller's abort signal to the model request", async () => {
      // The signal is what lets a cancelled translation stop the detection it is waiting on;
      // dropping it here leaves the request running with nobody left to read its answer.
      const controller = new AbortController()

      await detectLanguageOrUnknown('Hello', controller.signal)

      expect(generateTextMock.mock.calls[0][0].requestOptions?.signal).toBe(controller.signal)
    })

    it('offers the model the languages the database holds, not a built-in list', async () => {
      listMock.mockReturnValue([language('zh-cn')])

      await detectLanguageOrUnknown('Hello')

      expect(generateTextMock.mock.calls[0][0].system).toContain(JSON.stringify(['zh-cn']))
    })

    it('disables reasoning, which detection has no use for', async () => {
      await detectLanguageOrUnknown('Hello')

      expect(generateTextMock).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: 'none' }))
    })

    it('gives up when no usable model is configured', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.quick_assistant.model_id', undefined as never)
      MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', undefined as never)

      await expect(detectLanguageOrUnknown('Hello')).resolves.toBe('unknown')
      expect(lastFailure().message).toBe('error.model.not_exists')
    })

    it('falls back to the default model when no quick-assistant model is set', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.quick_assistant.model_id', undefined as never)
      MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', 'anthropic::claude')

      await detectLanguageOrUnknown('Hello')

      expect(getByKeyMock).toHaveBeenCalledWith('anthropic', 'claude')
    })

    it('gives up when the model replies with nothing', async () => {
      generateTextMock.mockResolvedValueOnce({ text: '   ' })

      await expect(detectLanguageOrUnknown('Hello')).resolves.toBe('unknown')
      expect(lastFailure().message).toBe('translate.error.detect.empty')
    })

    it('gives up when the model replies with something that is not a lang code', async () => {
      generateTextMock.mockResolvedValueOnce({ text: 'NOT_A_CODE' })

      await expect(detectLanguageOrUnknown('Hello')).resolves.toBe('unknown')
      expect(lastFailure().message).toBe('translate.error.detect.invalid')
    })

    it('records a generation failure as itself, not as an empty reply', async () => {
      generateTextMock.mockRejectedValueOnce(new Error('rate limited'))

      await expect(detectLanguageOrUnknown('Hello')).resolves.toBe('unknown')
      expect(lastFailure().message).toBe('rate limited')
    })
  })

  describe('franc method', () => {
    beforeEach(() => {
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.auto_detection_method', 'franc')
    })

    it('maps a recognized iso3 to its lang code without reaching the model', async () => {
      francMock.mockReturnValueOnce('cmn')

      await expect(detectLanguageOrUnknown('你好世界')).resolves.toBe('zh-cn')
      expect(generateTextMock).not.toHaveBeenCalled()
    })

    it('answers unknown for an iso3 the map has no entry for', async () => {
      francMock.mockReturnValueOnce('xxx')

      await expect(detectLanguageOrUnknown('???')).resolves.toBe('unknown')
    })
  })

  describe('auto method', () => {
    beforeEach(() => {
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.auto_detection_method', 'auto')
    })

    it('spends a model call on short text, where franc is unreliable', async () => {
      estimateTokenCountMock.mockReturnValue(10)

      await expect(detectLanguageOrUnknown('Hi')).resolves.toBe('en-us')
      expect(generateTextMock).toHaveBeenCalledTimes(1)
      expect(francMock).not.toHaveBeenCalled()
    })

    it('keeps long text offline when franc resolves it', async () => {
      estimateTokenCountMock.mockReturnValue(500)
      francMock.mockReturnValueOnce('jpn')

      await expect(detectLanguageOrUnknown('日本語の長い文章…')).resolves.toBe('ja-jp')
      expect(generateTextMock).not.toHaveBeenCalled()
    })

    it('falls back to the model when franc cannot place long text', async () => {
      estimateTokenCountMock.mockReturnValue(500)
      francMock.mockReturnValueOnce('und')

      await expect(detectLanguageOrUnknown('gibberish text')).resolves.toBe('en-us')
      expect(generateTextMock).toHaveBeenCalledTimes(1)
    })
  })

  it('returns unknown for blank input without reaching any detector', async () => {
    await expect(detectLanguageOrUnknown('   ')).resolves.toBe('unknown')

    expect(generateTextMock).not.toHaveBeenCalled()
    expect(francMock).not.toHaveBeenCalled()
    expect(listMock).not.toHaveBeenCalled()
  })

  it('does not ask a model to choose from an empty language list', async () => {
    // A list that loaded and came back empty is a broken install, not a language nobody speaks —
    // the log is what tells the two apart, since the answer is UNKNOWN either way.
    listMock.mockReturnValue([])

    await expect(detectLanguageOrUnknown('Hello')).resolves.toBe('unknown')
    expect(lastFailure().message).toBe('translate.error.detect.no_languages')
    expect(generateTextMock).not.toHaveBeenCalled()
  })
})
