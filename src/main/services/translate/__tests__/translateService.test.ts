import type { TranslateLanguage } from '@shared/data/types/translate'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `application.get('PreferenceService')` is mocked globally via
// tests/main.setup.ts. We only need to override `AiStreamManager` so we can
// assert on the streamPrompt call.
const streamPromptMock = vi.fn(() => ({ mode: 'started' as const, activeExecutions: [] }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiStreamManager: { streamPrompt: streamPromptMock }
  } as never)
})

const getByKeyMock = vi.fn()
vi.mock('@main/data/services/ModelService', () => ({
  modelService: { getByKey: getByKeyMock }
}))

const getByLangCodeMock = vi.fn()
vi.mock('@main/data/services/TranslateLanguageService', () => ({
  translateLanguageService: { getByLangCode: getByLangCodeMock }
}))

// `WebContentsListener` writes to `event.sender.send(...)` — stub it so the
// test doesn't need a real WebContents.
vi.mock('../../../ai/streamManager/listeners/WebContentsListener', () => ({
  WebContentsListener: vi.fn().mockImplementation((sender: unknown, streamId: string) => ({
    id: `wc:test:${streamId}`,
    sender,
    streamId,
    onError: vi.fn()
  }))
}))

const { translateService } = await import('../translateService')

const TARGET: TranslateLanguage = {
  langCode: 'en-us',
  value: 'English',
  emoji: '🇺🇸',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
} as unknown as TranslateLanguage

const fakeSender = { id: 1 } as unknown as Electron.WebContents

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  getByKeyMock.mockReset()
  getByLangCodeMock.mockReset()
  streamPromptMock.mockReset()
  streamPromptMock.mockReturnValue({ mode: 'started' as const, activeExecutions: [] })
})

describe('translateService.resolveTranslatePayload', () => {
  it('interpolates {{target_language}} and {{text}} into the configured prompt', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.model_id', 'openai::gpt-4o')
    MockMainPreferenceServiceUtils.setPreferenceValue(
      'feature.translate.model_prompt',
      'Translate to {{target_language}}: {{text}}'
    )
    getByKeyMock.mockReturnValue({ id: 'openai::gpt-4o', providerId: 'openai', apiModelId: 'gpt-4o', name: 'GPT-4o' })

    const payload = translateService.resolveTranslatePayload('hello', TARGET)

    expect(payload.uniqueModelId).toBe('openai::gpt-4o')
    expect(payload.content).toBe('Translate to English: hello')
    expect(getByKeyMock).toHaveBeenCalledWith('openai', 'gpt-4o')
  })

  it('interpolates replacement tokens and placeholder-shaped values literally', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.model_id', 'openai::gpt-4o')
    MockMainPreferenceServiceUtils.setPreferenceValue(
      'feature.translate.model_prompt',
      'A {{target_language}} B {{text}} C {{target_language}} D {{text}}'
    )
    getByKeyMock.mockReturnValue({ id: 'openai::gpt-4o', providerId: 'openai', apiModelId: 'gpt-4o', name: 'GPT-4o' })
    const sourceText = "$$E=mc^2$$ | $& | $` | $' | {{target_language}}"
    const targetLanguage = {
      ...TARGET,
      value: "$$English$$ | $& | $` | $' | {{text}}"
    }

    const payload = translateService.resolveTranslatePayload(sourceText, targetLanguage)

    expect(payload.content).toBe(`A ${targetLanguage.value} B ${sourceText} C ${targetLanguage.value} D ${sourceText}`)
  })

  it('skips interpolation for Qwen MT models — passes raw source text', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.model_id', 'dashscope::qwen-mt-turbo')
    MockMainPreferenceServiceUtils.setPreferenceValue(
      'feature.translate.model_prompt',
      'Translate to {{target_language}}: {{text}}'
    )
    getByKeyMock.mockReturnValue({
      id: 'dashscope::qwen-mt-turbo',
      providerId: 'dashscope',
      apiModelId: 'qwen-mt-turbo',
      name: 'Qwen MT Turbo'
    })

    const payload = translateService.resolveTranslatePayload('原文', TARGET)

    expect(payload.uniqueModelId).toBe('dashscope::qwen-mt-turbo')
    expect(payload.content).toBe('原文')
  })

  it('throws translate.error.not_configured when the translate model preference is unset', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.model_id', '' as any)

    expect(() => translateService.resolveTranslatePayload('source', TARGET)).toThrow('translate.error.not_configured')
    expect(getByKeyMock).not.toHaveBeenCalled()
  })

  it('throws translate.error.not_configured when the model row is missing', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.model_id', 'openai::gpt-4o')
    getByKeyMock.mockImplementation(() => {
      throw new Error('not found')
    })

    expect(() => translateService.resolveTranslatePayload('source', TARGET)).toThrow('translate.error.not_configured')
  })
})

describe('translateService.open', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.model_id', 'openai::gpt-4o')
    MockMainPreferenceServiceUtils.setPreferenceValue(
      'feature.translate.model_prompt',
      'Translate to {{target_language}}: {{text}}'
    )
    getByKeyMock.mockReturnValue({ id: 'openai::gpt-4o', providerId: 'openai', apiModelId: 'gpt-4o', name: 'GPT-4o' })
    getByLangCodeMock.mockReturnValue(TARGET)
  })

  it('uses the renderer-supplied streamId, resolves the DTO, and dispatches via streamManager.streamPrompt', async () => {
    const streamId = 'translate:caller-supplied-id'
    const result = translateService.open(fakeSender, {
      streamId,
      text: 'hello',
      targetLangCode: 'en-us'
    })

    expect(getByLangCodeMock).toHaveBeenCalledWith('en-us')
    expect(result.streamId).toBe(streamId)
    expect(streamPromptMock).toHaveBeenCalledTimes(1)
    const arg = (
      streamPromptMock.mock.calls as unknown as Array<
        [
          {
            streamId: string
            uniqueModelId: string
            prompt: string
            reasoningEffort?: string
            listener: { id: string } | Array<{ id: string }>
          }
        ]
      >
    )[0][0]
    expect(arg.streamId).toBe(streamId)
    expect(arg.uniqueModelId).toBe('openai::gpt-4o')
    expect(arg.prompt).toBe('Translate to English: hello')
    // Translation always requests thinking off; unsupported models degrade to omit downstream.
    expect(arg.reasoningEffort).toBe('none')
    const listeners = Array.isArray(arg.listener) ? arg.listener : [arg.listener]
    expect(listeners).toHaveLength(1)
    expect(listeners[0].id).toBe(`wc:test:${streamId}`)
  })

  it('rejects a streamId that does not carry the translate prefix', async () => {
    expect(() =>
      translateService.open(fakeSender, {
        streamId: 'agent-session:bogus',
        text: 'hello',
        targetLangCode: 'en-us'
      })
    ).toThrow(/translate:/)
    expect(getByLangCodeMock).not.toHaveBeenCalled()
    expect(streamPromptMock).not.toHaveBeenCalled()
  })

  it('throws for an invalid lang code without touching the DTO service or stream manager', async () => {
    expect(() =>
      translateService.open(fakeSender, {
        streamId: 'translate:abc',
        text: 'hello',
        targetLangCode: 'not-a-real-code' as any
      })
    ).toThrow('Invalid target language: not-a-real-code')
    expect(getByLangCodeMock).not.toHaveBeenCalled()
    expect(streamPromptMock).not.toHaveBeenCalled()
  })

  it('throws for the "unknown" sentinel', async () => {
    expect(() =>
      translateService.open(fakeSender, {
        streamId: 'translate:abc',
        text: 'hello',
        targetLangCode: 'unknown' as any
      })
    ).toThrow('Invalid target language: unknown')
    expect(getByLangCodeMock).not.toHaveBeenCalled()
  })
})
