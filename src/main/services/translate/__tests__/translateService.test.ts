import { MODEL_CAPABILITY } from '@shared/data/types/model'
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

const getByProviderIdMock = vi.fn()
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: getByProviderIdMock }
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

const { makeModel } = await import('../../../ai/__tests__/fixtures')
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
  getByProviderIdMock.mockReset().mockImplementation((providerId: string) => ({ id: providerId }))
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

  it('treats a model rejected by the provider service as not configured', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.model_id', 'global-only::model')
    getByProviderIdMock.mockImplementationOnce(() => {
      throw new Error('provider not found')
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
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.translate.enable_temperature': true,
      'feature.translate.temperature': 0.3,
      'feature.translate.enable_max_tokens': true,
      'feature.translate.max_tokens': 512
    })
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
            callOverrides?: Record<string, unknown>
            listener: { id: string } | Array<{ id: string }>
          }
        ]
      >
    )[0][0]
    expect(arg.streamId).toBe(streamId)
    expect(arg.uniqueModelId).toBe('openai::gpt-4o')
    expect(arg.prompt).toBe('Translate to English: hello')
    // Ships the stored effort — 'none' by default; unsupported values degrade downstream.
    expect(arg.reasoningEffort).toBe('none')
    // The whole feature hangs off this one argument: drop it and every other
    // assertion in this file still passes while nothing reaches the model.
    expect(arg.callOverrides).toEqual({ temperature: 0.3, maxOutputTokens: 512 })
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

describe('translateService.resolveRequestParameters', () => {
  const enableAll = () => {
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.translate.enable_temperature': true,
      'feature.translate.temperature': 0.3,
      'feature.translate.enable_top_p': true,
      'feature.translate.top_p': 0.8,
      'feature.translate.enable_max_tokens': true,
      'feature.translate.max_tokens': 2048
    })
  }

  it('sends nothing while every parameter is off, leaving the model at its own defaults', () => {
    const params = translateService.resolveRequestParameters(makeModel())

    expect(params.reasoningEffort).toBe('none')
    expect(params.callOverrides).toEqual({})
  })

  it('sends each enabled parameter', () => {
    enableAll()

    const params = translateService.resolveRequestParameters(makeModel())

    expect(params.callOverrides).toEqual({ temperature: 0.3, topP: 0.8, maxOutputTokens: 2048 })
  })

  it('drops a sampling parameter the model rejects and keeps the rest', () => {
    enableAll()
    // Claude 4.5 accepts temperature or topP, never both.
    const model = makeModel({ id: 'anthropic::claude-sonnet-4-5-20250101', providerId: 'anthropic' })

    const params = translateService.resolveRequestParameters(model)

    expect(params.callOverrides).toEqual({ temperature: 0.3, maxOutputTokens: 2048 })
  })

  it('drops temperature once the stored effort turns Claude thinking on', () => {
    enableAll()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.reasoning_effort', 'high')
    const model = makeModel({
      id: 'anthropic::claude-sonnet-4-5-20250101',
      providerId: 'anthropic',
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: { controls: [{ kind: 'effort', values: ['low', 'high'] }], selectableEfforts: ['low', 'high'] }
    })

    const params = translateService.resolveRequestParameters(model)

    expect(params.reasoningEffort).toBe('high')
    expect(params.callOverrides.temperature).toBeUndefined()
  })

  it('keeps temperature when the model declares no effort the stored selection can reach', () => {
    // claude-sonnet-4-5 and four siblings declare only none/auto, so a stored 'high'
    // resolves to nothing and no thinking is sent — the temperature must survive it.
    enableAll()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.reasoning_effort', 'high')
    const model = makeModel({
      id: 'anthropic::claude-sonnet-4-5',
      providerId: 'anthropic',
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: { controls: [{ kind: 'toggle' }], selectableEfforts: ['none', 'auto'] }
    })

    expect(translateService.resolveRequestParameters(model).callOverrides.temperature).toBe(0.3)
  })

  it('drops temperature when the stored effort resolves to a neighbour the model does declare', () => {
    enableAll()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.reasoning_effort', 'high')
    const model = makeModel({
      id: 'anthropic::claude-sonnet-4-5',
      providerId: 'anthropic',
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: { controls: [{ kind: 'effort', values: ['low', 'medium'] }], selectableEfforts: ['low', 'medium'] }
    })

    expect(translateService.resolveRequestParameters(model).callOverrides.temperature).toBeUndefined()
  })

  it("keeps temperature on the same model when the effort is left at the provider's default", () => {
    enableAll()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.reasoning_effort', 'default')
    const model = makeModel({
      id: 'anthropic::claude-sonnet-4-5-20250101',
      providerId: 'anthropic',
      capabilities: [MODEL_CAPABILITY.REASONING]
    })

    const params = translateService.resolveRequestParameters(model)

    expect(params.callOverrides.temperature).toBe(0.3)
  })
})
