import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `application.get('PreferenceService')` is mocked globally via
// tests/main.setup.ts. We only need to override `AiStreamManager` so we can
// assert on the streamPrompt call.
const streamPromptMock = vi.fn(() => ({ mode: 'started' as const, activeExecutions: [] }))
const webContentsListenerMocks = vi.hoisted(() => ({
  instances: [] as Array<{
    id: string
    onChunk: ReturnType<typeof vi.fn>
    onDone: ReturnType<typeof vi.fn>
    onPaused: ReturnType<typeof vi.fn>
    onError: ReturnType<typeof vi.fn>
    isAlive: ReturnType<typeof vi.fn>
  }>
}))

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
  WebContentsListener: vi.fn().mockImplementation((_sender: unknown, streamId: string) => {
    const listener = {
      id: `wc:test:${streamId}`,
      onChunk: vi.fn(),
      onDone: vi.fn(),
      onPaused: vi.fn(),
      onError: vi.fn(),
      isAlive: vi.fn(() => true)
    }
    webContentsListenerMocks.instances.push(listener)
    return listener
  })
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

function mockQwenMtModel(modelId: string, providerId = 'dashscope') {
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.model_id', `${providerId}::${modelId}`)
  getByKeyMock.mockReturnValue({
    id: `${providerId}::${modelId}`,
    providerId,
    apiModelId: modelId,
    name: modelId
  })
}

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  getByKeyMock.mockReset()
  getByProviderIdMock.mockReset().mockImplementation((providerId: string) => ({ id: providerId }))
  getByLangCodeMock.mockReset()
  streamPromptMock.mockReset()
  streamPromptMock.mockReturnValue({ mode: 'started' as const, activeExecutions: [] })
  webContentsListenerMocks.instances.length = 0
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
      'feature.translate.temperature': 0.3
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
    expect(arg.callOverrides).toEqual({ temperature: 0.3 })
    const listeners = Array.isArray(arg.listener) ? arg.listener : [arg.listener]
    expect(listeners).toHaveLength(1)
    expect(listeners[0].id).toBe(`wc:test:${streamId}`)
  })

  it.each([
    ['zh-cn', 'Chinese (Simplified)', 'Chinese'],
    ['zh', 'Chinese', 'Chinese'],
    ['zh-tw', 'Chinese (Traditional)', 'Traditional Chinese'],
    ['zh-yue', 'Cantonese', 'Cantonese']
  ] as const)('maps %s (%s) to the Qwen MT target language %s', (targetLangCode, value, expectedTargetLanguage) => {
    mockQwenMtModel('qwen-mt-turbo')
    getByLangCodeMock.mockReturnValue({
      ...TARGET,
      langCode: targetLangCode,
      value
    })

    translateService.open(fakeSender, {
      streamId: `translate:qwen-mt-${targetLangCode}`,
      text: '原文',
      targetLangCode
    })

    expect(streamPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '原文',
        callOverrides: expect.objectContaining({
          providerOptions: {
            dashscope: {
              translation_options: {
                source_lang: 'auto',
                target_lang: expectedTargetLanguage
              }
            }
          }
        })
      })
    )
  })

  it.each(['qwen-mt-flash', 'qwen-mt-lite'])('enables incremental output for %s', (modelId) => {
    mockQwenMtModel(modelId)
    getByLangCodeMock.mockReturnValue(TARGET)

    translateService.open(fakeSender, {
      streamId: `translate:${modelId}`,
      text: 'source',
      targetLangCode: 'en-us'
    })

    expect(streamPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        callOverrides: expect.objectContaining({
          providerOptions: {
            dashscope: expect.objectContaining({ incremental_output: true })
          }
        })
      })
    )
  })

  it('uses the DashScope runtime namespace for a preset-derived provider instance', () => {
    mockQwenMtModel('qwen-mt-turbo', 'dashscope-copy')
    getByProviderIdMock.mockReturnValue({ id: 'dashscope-copy', presetProviderId: 'dashscope' })
    getByLangCodeMock.mockReturnValue(TARGET)

    translateService.open(fakeSender, {
      streamId: 'translate:qwen-mt-preset-copy',
      text: 'source',
      targetLangCode: 'en-us'
    })

    expect(streamPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        callOverrides: expect.objectContaining({
          providerOptions: {
            dashscope: expect.objectContaining({ translation_options: expect.any(Object) })
          }
        })
      })
    )
  })

  it('uses the OpenAI runtime namespace for a DashScope Responses endpoint', () => {
    mockQwenMtModel('qwen-mt-turbo')
    getByProviderIdMock.mockReturnValue({
      id: 'dashscope',
      presetProviderId: 'dashscope',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: {
          adapterFamily: 'openai',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/'
        }
      }
    })
    getByLangCodeMock.mockReturnValue(TARGET)

    translateService.open(fakeSender, {
      streamId: 'translate:qwen-mt-responses',
      text: 'source',
      targetLangCode: 'en-us'
    })

    expect(streamPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        callOverrides: expect.objectContaining({
          providerOptions: {
            openai: expect.objectContaining({ translation_options: expect.any(Object) })
          }
        })
      })
    )
  })

  it('uses the Anthropic runtime namespace for a DashScope Anthropic endpoint', () => {
    mockQwenMtModel('qwen-mt-turbo')
    getByProviderIdMock.mockReturnValue({
      id: 'dashscope',
      presetProviderId: 'dashscope',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          adapterFamily: 'anthropic',
          baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic'
        }
      }
    })
    getByLangCodeMock.mockReturnValue(TARGET)

    translateService.open(fakeSender, {
      streamId: 'translate:qwen-mt-anthropic',
      text: 'source',
      targetLangCode: 'en-us'
    })

    expect(streamPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        callOverrides: expect.objectContaining({
          providerOptions: {
            anthropic: expect.objectContaining({ translation_options: expect.any(Object) })
          }
        })
      })
    )
  })

  it.each(['qwen-mt-plus', 'qwen-mt-turbo', 'qwen-mt-plus(free)'])(
    'normalizes cumulative %s chunks before renderer delivery',
    (modelId) => {
      mockQwenMtModel(modelId)
      getByLangCodeMock.mockReturnValue(TARGET)

      translateService.open(fakeSender, {
        streamId: `translate:${modelId}`,
        text: 'source',
        targetLangCode: 'en-us'
      })

      const [streamInput] = streamPromptMock.mock.calls[0] as unknown as [
        { listener: { onChunk(chunk: unknown): void } }
      ]
      streamInput.listener.onChunk({ type: 'text-delta', id: 'text-1', delta: 'Hello' })
      streamInput.listener.onChunk({ type: 'text-delta', id: 'text-1', delta: 'Hello world' })

      const rendererListener = webContentsListenerMocks.instances[0]
      expect(rendererListener.onChunk).toHaveBeenNthCalledWith(
        1,
        { type: 'text-delta', id: 'text-1', delta: 'Hello' },
        undefined,
        undefined,
        undefined
      )
      expect(rendererListener.onChunk).toHaveBeenNthCalledWith(
        2,
        { type: 'text-delta', id: 'text-1', delta: ' world' },
        undefined,
        undefined,
        undefined
      )
    }
  )

  it('rejects a Qwen MT target language that the model does not support', () => {
    mockQwenMtModel('qwen-mt-turbo')
    getByLangCodeMock.mockReturnValue({ ...TARGET, langCode: 'eo', value: 'Esperanto' })

    expect(() =>
      translateService.open(fakeSender, {
        streamId: 'translate:qwen-mt-unsupported',
        text: 'source',
        targetLangCode: 'eo' as any
      })
    ).toThrow('translate.error.not_supported')
    expect(streamPromptMock).not.toHaveBeenCalled()
  })

  it("rejects a target outside qwen-mt-lite's 31-language contract", () => {
    mockQwenMtModel('qwen-mt-lite')
    getByLangCodeMock.mockReturnValue({ ...TARGET, langCode: 'el', value: 'Greek' })

    expect(() =>
      translateService.open(fakeSender, {
        streamId: 'translate:qwen-mt-lite-unsupported',
        text: 'source',
        targetLangCode: 'el'
      })
    ).toThrow('translate.error.not_supported')
    expect(streamPromptMock).not.toHaveBeenCalled()
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
      'feature.translate.top_p': 0.8
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

    expect(params.callOverrides).toEqual({ temperature: 0.3, topP: 0.8 })
  })

  it('drops a sampling parameter the model rejects and keeps the rest', () => {
    enableAll()
    // Claude 4.5 accepts temperature or topP, never both.
    const model = makeModel({ id: 'anthropic::claude-sonnet-4-5-20250101', providerId: 'anthropic' })

    const params = translateService.resolveRequestParameters(model)

    expect(params.callOverrides).toEqual({ temperature: 0.3 })
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

  it('keeps temperature when a stored auto reaches a model whose vocabulary cannot offer it', () => {
    // 'auto' is synthesized per model: a toggle model offers it, a budget model never does.
    // Carried onto the latter, Main degrades it to 'default' and Anthropic declares no default
    // mode, so nothing is sent — the temperature must not be spent on that.
    enableAll()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.reasoning_effort', 'auto')
    const model = makeModel({
      id: 'anthropic::claude-sonnet-4-5',
      providerId: 'anthropic',
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: { controls: [{ kind: 'budget', min: 1024, max: 8192 }], selectableEfforts: ['low', 'medium', 'high'] }
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
