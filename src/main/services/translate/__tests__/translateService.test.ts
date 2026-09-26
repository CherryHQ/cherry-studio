import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import type { TranslateLanguage } from '@shared/data/types/translate'

const fileTypeFromBufferMock = vi.hoisted(() => vi.fn())
vi.mock('file-type', () => ({ fileTypeFromBuffer: fileTypeFromBufferMock }))

// `application.get('PreferenceService')` is mocked globally via
// tests/main.setup.ts. We only need to override `AiStreamManager` so we can
// assert on the streamPrompt call.
const registeredStreams = new Set<string>()
const abortedRegisteredStreams = new Set<string>()
const streamPromptMock = vi.fn((request: { streamId: string }) => {
  registeredStreams.add(request.streamId)
  return { mode: 'started' as const, activeExecutions: [] }
})
const dispatchLocks = new KeyedMutex()
const withDispatchLockMock = vi.fn((topicId: string, operation: () => Promise<unknown>) =>
  dispatchLocks.runExclusive(topicId, operation)
)
const abortAndDrainMock = vi.fn((topicId: string) =>
  dispatchLocks.runExclusive(topicId, async () => {
    if (!registeredStreams.has(topicId)) return
    abortedRegisteredStreams.add(topicId)
    const streamRequest = streamPromptMock.mock.calls.find(([request]) => request.streamId === topicId)?.[0] as
      | { listener: Array<{ terminalPhase?: string; onPaused: (result: never) => void | Promise<void> }> }
      | undefined
    const listeners = Array.isArray(streamRequest?.listener) ? streamRequest.listener : []
    await listeners.find((listener) => listener.terminalPhase === 'cleanup')?.onPaused({} as never)
  })
)
const createInternalEntryMock = vi.fn()
const getFileUrlMock = vi.fn()
const permanentDeleteMock = vi.fn()

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiStreamManager: {
      streamPrompt: streamPromptMock,
      withDispatchLock: withDispatchLockMock,
      abortAndDrain: abortAndDrainMock
    },
    FileManager: {
      createInternalEntry: createInternalEntryMock,
      getUrl: getFileUrlMock,
      permanentDelete: permanentDeleteMock
    }
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
  WebContentsListener: vi.fn().mockImplementation(function WebContentsListenerMock(sender: unknown, streamId: string) {
    return {
      id: `wc:test:${streamId}`,
      sender,
      streamId,
      onError: vi.fn()
    }
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
const IMAGE_ENTRY_ID = '019606a0-0000-7000-8000-000000000058' as const
const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const IMAGE = { data: IMAGE_BYTES, filename: 'screenshot.png' }

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  getByKeyMock.mockReset()
  getByProviderIdMock.mockReset().mockImplementation((providerId: string) => ({ id: providerId }))
  getByLangCodeMock.mockReset()
  streamPromptMock.mockReset()
  streamPromptMock.mockImplementation((request: { streamId: string }) => {
    registeredStreams.add(request.streamId)
    return { mode: 'started' as const, activeExecutions: [] }
  })
  registeredStreams.clear()
  abortedRegisteredStreams.clear()
  withDispatchLockMock.mockClear()
  abortAndDrainMock.mockClear()
  fileTypeFromBufferMock.mockReset().mockResolvedValue({ ext: 'png', mime: 'image/png' })
  createInternalEntryMock.mockReset().mockResolvedValue({
    id: IMAGE_ENTRY_ID,
    origin: 'internal',
    name: 'translation-image',
    ext: 'png',
    cleanupPolicy: 'delete_when_unreferenced',
    size: 1,
    contentHash: null,
    createdAt: 1,
    updatedAt: 1
  })
  getFileUrlMock.mockReset().mockReturnValue(`file:///managed/${IMAGE_ENTRY_ID}.png`)
  permanentDeleteMock.mockReset().mockResolvedValue(undefined)
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
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.model_id', '')

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
    const result = await translateService.open(fakeSender, {
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

  it('sniffs image bytes, stages a fresh entry, and sends a multimodal user message', async () => {
    const streamId = 'translate:with-image'
    await translateService.open(fakeSender, {
      streamId,
      text: 'translate this screenshot',
      targetLangCode: 'en-us',
      image: IMAGE
    })

    expect(fileTypeFromBufferMock).toHaveBeenCalledWith(IMAGE_BYTES)
    expect(createInternalEntryMock).toHaveBeenCalledWith({
      source: 'bytes',
      data: IMAGE_BYTES,
      name: 'translation-image',
      ext: 'png',
      cleanupPolicy: 'delete_when_unreferenced'
    })
    expect(streamPromptMock).toHaveBeenCalledTimes(1)
    const arg = (
      streamPromptMock.mock.calls as unknown as Array<
        [
          {
            prompt?: string
            messages?: Array<{
              role: string
              parts: Array<{ type: string; text?: string; url?: string; filename?: string }>
            }>
          }
        ]
      >
    )[0][0]
    expect(arg.prompt).toBeUndefined()
    expect(arg.messages).toHaveLength(1)
    expect(arg.messages?.[0].role).toBe('user')
    expect(arg.messages?.[0].parts).toEqual([
      { type: 'text', text: 'Translate to English: translate this screenshot' },
      {
        type: 'file',
        mediaType: 'image/png',
        url: `file:///managed/${IMAGE_ENTRY_ID}.png`,
        filename: IMAGE.filename
      }
    ])
  })

  it('holds the topic lock through image validation and synchronous stream registration', async () => {
    const streamId = 'translate:abort-during-validation'
    let resolveFileType: ((type: { ext: string; mime: string }) => void) | undefined
    fileTypeFromBufferMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFileType = resolve
        })
    )

    const opening = translateService.open(fakeSender, {
      streamId,
      text: 'translate this screenshot',
      targetLangCode: 'en-us',
      image: IMAGE
    })
    await vi.waitFor(() => expect(fileTypeFromBufferMock).toHaveBeenCalledWith(IMAGE_BYTES))

    let abortFoundRegisteredStream: boolean | undefined
    const aborting = abortAndDrainMock(streamId).then(() => {
      abortFoundRegisteredStream = abortedRegisteredStreams.has(streamId)
    })
    await Promise.resolve()
    expect(abortFoundRegisteredStream).toBeUndefined()

    resolveFileType?.({ ext: 'png', mime: 'image/png' })
    await expect(opening).resolves.toEqual({ streamId })
    await aborting

    expect(abortFoundRegisteredStream).toBe(true)
    expect(abortAndDrainMock).toHaveBeenCalledWith(streamId)
    expect(permanentDeleteMock).toHaveBeenCalledWith(IMAGE_ENTRY_ID)
  })

  it.each(['onDone', 'onPaused', 'onError'] as const)('deletes the staged image after terminal %s', async (method) => {
    await translateService.open(fakeSender, {
      streamId: `translate:cleanup-${method}`,
      text: 'hello',
      targetLangCode: 'en-us',
      image: IMAGE
    })

    const request = streamPromptMock.mock.calls[0][0] as unknown as {
      listener: Array<{
        terminalPhase?: string
        onDone: (result: never) => void | Promise<void>
        onPaused: (result: never) => void | Promise<void>
        onError: (result: never) => void | Promise<void>
      }>
    }
    const cleanup = request.listener.find((listener) => listener.terminalPhase === 'cleanup')
    expect(cleanup).toBeDefined()

    await cleanup?.[method]({} as never)
    await cleanup?.[method]({} as never)

    expect(permanentDeleteMock).toHaveBeenCalledTimes(1)
    expect(permanentDeleteMock).toHaveBeenCalledWith(IMAGE_ENTRY_ID)
  })

  it('does not turn a successful stream terminal into an error when image cleanup fails', async () => {
    permanentDeleteMock.mockRejectedValueOnce(new Error('cleanup failed'))
    await translateService.open(fakeSender, {
      streamId: 'translate:cleanup-failure',
      text: 'hello',
      targetLangCode: 'en-us',
      image: IMAGE
    })
    const request = streamPromptMock.mock.calls[0][0] as unknown as {
      listener: Array<{ terminalPhase?: string; onDone: (result: never) => void | Promise<void> }>
    }
    const cleanup = request.listener.find((listener) => listener.terminalPhase === 'cleanup')

    await expect(cleanup?.onDone({} as never)).resolves.toBeUndefined()
  })

  it('deletes the staged image when stream registration fails without masking the error', async () => {
    streamPromptMock.mockImplementationOnce(() => {
      throw new Error('stream registration failed')
    })
    permanentDeleteMock.mockRejectedValueOnce(new Error('cleanup failed'))

    await expect(
      translateService.open(fakeSender, {
        streamId: 'translate:registration-failure',
        text: 'hello',
        targetLangCode: 'en-us',
        image: IMAGE
      })
    ).rejects.toThrow('stream registration failed')
    expect(permanentDeleteMock).toHaveBeenCalledWith(IMAGE_ENTRY_ID)
  })

  it('asks the vision model to judge an image-only request and translate only into the configured target', async () => {
    // Catches image-only falling through to the text template, which can name
    // the other side of a bidirectional pair instead of the configured target.
    MockMainPreferenceServiceUtils.setPreferenceValue(
      'feature.translate.model_prompt',
      'If the image is already {{target_language}}, translate it into Chinese instead: {{text}}'
    )

    await translateService.open(fakeSender, {
      streamId: 'translate:image-only',
      text: '',
      targetLangCode: 'en-us',
      image: IMAGE
    })

    expect(getByLangCodeMock).toHaveBeenCalledWith('en-us')
    expect(streamPromptMock).toHaveBeenCalledTimes(1)
    const request = (
      streamPromptMock.mock.calls as unknown as Array<
        [
          {
            prompt?: string
            messages?: Array<{
              id: string
              role: string
              parts: Array<{ type: string; text?: string; mediaType?: string; url?: string; filename?: string }>
            }>
          }
        ]
      >
    )[0][0]
    expect(request.prompt).toBeUndefined()
    expect(request.messages).toEqual([
      {
        id: 'translate-user',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'Identify the language of the text in the attached image and translate it into English. Provide only the translation and preserve the original formatting.'
          },
          {
            type: 'file',
            mediaType: 'image/png',
            url: `file:///managed/${IMAGE_ENTRY_ID}.png`,
            filename: IMAGE.filename
          }
        ]
      }
    ])
  })

  it('rejects a streamId that does not carry the translate prefix', async () => {
    await expect(
      translateService.open(fakeSender, {
        streamId: 'agent-session:bogus',
        text: 'hello',
        targetLangCode: 'en-us'
      })
    ).rejects.toThrow(/translate:/)
    expect(getByLangCodeMock).not.toHaveBeenCalled()
    expect(streamPromptMock).not.toHaveBeenCalled()
  })

  it('throws for an invalid lang code without touching the DTO service or stream manager', async () => {
    await expect(
      translateService.open(fakeSender, {
        streamId: 'translate:abc',
        text: 'hello',
        targetLangCode: 'not-a-real-code' as any
      })
    ).rejects.toThrow('Invalid target language: not-a-real-code')
    expect(getByLangCodeMock).not.toHaveBeenCalled()
    expect(streamPromptMock).not.toHaveBeenCalled()
  })

  it('throws for the "unknown" sentinel', async () => {
    await expect(
      translateService.open(fakeSender, {
        streamId: 'translate:abc',
        text: 'hello',
        targetLangCode: 'unknown' as any
      })
    ).rejects.toThrow('Invalid target language: unknown')
    expect(getByLangCodeMock).not.toHaveBeenCalled()
  })

  it('accepts detected JPEG bytes regardless of the supplied filename extension', async () => {
    fileTypeFromBufferMock.mockResolvedValueOnce({ ext: 'jpg', mime: 'image/jpeg' })

    await translateService.open(fakeSender, {
      streamId: 'translate:jpeg',
      text: 'hello',
      targetLangCode: 'en-us',
      image: { data: IMAGE_BYTES, filename: 'misnamed.png' }
    })

    expect(createInternalEntryMock).toHaveBeenCalledWith(expect.objectContaining({ ext: 'jpg' }))
    const request = streamPromptMock.mock.calls[0][0] as unknown as {
      messages: Array<{ parts: Array<{ type: string; mediaType?: string; filename?: string }> }>
    }
    expect(request.messages[0].parts[1]).toMatchObject({
      type: 'file',
      mediaType: 'image/jpeg',
      filename: 'misnamed.png'
    })
  })

  it.each([
    ['unrecognized bytes', undefined, 'recognized image'],
    ['spoofed PNG bytes', { ext: 'pdf', mime: 'application/pdf' }, 'recognized image'],
    ['an unsupported detected image', { ext: 'avif', mime: 'image/avif' }, 'Unsupported translation image type']
  ] as const)('rejects %s before creating an entry', async (_kind, detected, message) => {
    fileTypeFromBufferMock.mockResolvedValueOnce(detected)

    await expect(
      translateService.open(fakeSender, {
        streamId: 'translate:invalid-image',
        text: 'hello',
        targetLangCode: 'en-us',
        image: IMAGE
      })
    ).rejects.toThrow(message)
    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(permanentDeleteMock).not.toHaveBeenCalled()
    expect(streamPromptMock).not.toHaveBeenCalled()
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
