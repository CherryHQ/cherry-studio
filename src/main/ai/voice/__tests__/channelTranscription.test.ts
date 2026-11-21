import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as I18n from '@main/i18n'
import {
  APPLE_ASR_MODEL_ID,
  FUNASR_MODEL_ID,
  WINDOWS_ASR_MODEL_ID,
  TranscriptionLanguageSource
} from '@shared/ai/localVoice'
import { TranscriptionInputKind, TranscriptionOutputKind } from '@shared/ai/voice'

import type * as Adapters from '../localAdapters'
import type { VoiceEnvironment } from '../voicePlatform'

const mocks = vi.hoisted(() => ({
  preferences: vi.fn(),
  createInstance: vi.fn(),
  decode: vi.fn(),
  dispose: vi.fn(),
  status: vi.fn(),
  resolve: vi.fn(),
  start: vi.fn()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: { getMultiple: mocks.preferences },
    UtilityProcessManager: { createInstance: mocks.createInstance }
  } as never)
})
vi.mock('../localAdapters', () => ({
  getLocalVoiceStatus: mocks.status,
  resolveTranscriptionRequest: mocks.resolve,
  voiceAudioProcess: { id: 'voice.audio' }
}))
vi.mock('../execution', () => ({ startTranscription: mocks.start }))
vi.mock('@main/i18n', async (orig) => ({
  ...(await orig<typeof I18n>()),
  getAppLanguage: () => interfaceLanguage
}))

import { transcribeChannelAudio } from '../channelTranscription'
import { inspectCanonicalWav } from '../localAdapters/inspectCanonicalWav'

const actual = await vi.importActual<typeof Adapters>('../localAdapters')
let environment: VoiceEnvironment
let interfaceLanguage: string

const wav = Uint8Array.from(
  Buffer.from('524946462600000057415645666d74201000000001000100803e0000007d00000200100064617461020000000000', 'hex')
)
const input = { audio: Uint8Array.of(79, 103, 103), mimeType: ' Audio/OGG; codecs=opus' }
const result = () => ({ text: ' transcript ' })
const deferred = <T>() => Promise.withResolvers<T>()
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('channel transcription', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    environment = { platform: 'darwin', majorVersion: 26 }
    interfaceLanguage = 'ja-JP'
    mocks.preferences.mockReturnValue({ modelId: APPLE_ASR_MODEL_ID, language: '' })
    mocks.resolve.mockImplementation((input) => actual.resolveTranscriptionRequest(input, environment))
    mocks.status.mockResolvedValue({ status: 'ready' })
    mocks.createInstance.mockReturnValue({ request: mocks.decode, dispose: mocks.dispose })
    mocks.decode.mockResolvedValue({ wav })
    mocks.dispose.mockResolvedValue(undefined)
    mocks.start.mockImplementation(() => ({
      completed: Promise.resolve(result()),
      closed: Promise.resolve(),
      cancel: vi.fn().mockResolvedValue(undefined)
    }))
  })
  afterEach(() => vi.useRealTimers())

  it.each(['', 'invalid-model'])('rejects model %j before resolving or decoding', async (modelId) => {
    mocks.preferences.mockReturnValue({ modelId })
    await expect(transcribeChannelAudio(input)).rejects.toMatchObject({ reason: 'unsupported' })
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it.each(['unsupported', 'failed', 'downloading', 'not_installed'])(
    'rejects %s without creating a decoder or replacing the model',
    async (status) => {
      mocks.status.mockResolvedValue({ status })
      await expect(transcribeChannelAudio(input)).rejects.toMatchObject({ reason: 'unsupported' })
      expect(mocks.status).toHaveBeenCalledWith(APPLE_ASR_MODEL_ID, { language: 'ja-JP' }, expect.any(AbortSignal))
      expect(mocks.resolve).toHaveBeenCalledTimes(1)
      expect(mocks.createInstance).not.toHaveBeenCalled()
      expect(mocks.start).not.toHaveBeenCalled()
    }
  )

  it.each(['en-US', 'de-DE'])('keeps explicit model and language selection %j', async (language) => {
    mocks.preferences.mockReturnValue({ modelId: APPLE_ASR_MODEL_ID, language })
    await expect(transcribeChannelAudio(input)).resolves.toBe('transcript')
    expect(mocks.preferences).toHaveBeenCalledWith({
      modelId: 'feature.voice.recognition.model_id',
      language: 'feature.voice.recognition.language'
    })
    expect(mocks.resolve).toHaveBeenCalledWith({
      modelId: APPLE_ASR_MODEL_ID,
      language: { source: TranscriptionLanguageSource.Explicit, locale: language }
    })
    expect(mocks.status).toHaveBeenCalledWith(APPLE_ASR_MODEL_ID, { language }, expect.any(AbortSignal))
    expect(mocks.start).toHaveBeenCalledWith(
      {
        modelId: APPLE_ASR_MODEL_ID,
        input: { kind: TranscriptionInputKind.Audio, audio: wav },
        output: TranscriptionOutputKind.Final,
        options: { language }
      },
      expect.any(AbortSignal)
    )
    expect(inspectCanonicalWav(mocks.start.mock.calls[0][0].input.audio).dataBytes).toBe(2)
    expect(mocks.decode).toHaveBeenCalledWith(
      'decode',
      { audio: input.audio, mimeType: 'audio/ogg' },
      { signal: expect.any(AbortSignal) }
    )
    expect(mocks.createInstance).toHaveBeenCalledWith({ id: 'voice.audio' })
  })

  it.each([
    { modelId: APPLE_ASR_MODEL_ID, environment: { platform: 'darwin', majorVersion: 26 }, language: 'ja-JP' },
    { modelId: WINDOWS_ASR_MODEL_ID, environment: { platform: 'win32', arch: 'x64' }, language: 'ja-JP' },
    { modelId: FUNASR_MODEL_ID, environment: { platform: 'linux', arch: 'x64' }, language: undefined }
  ])('follows interface language with $modelId', async ({ modelId, environment: modelEnvironment, language }) => {
    environment = modelEnvironment
    mocks.preferences.mockReturnValue({ modelId, language: '' })
    await expect(transcribeChannelAudio(input)).resolves.toBe('transcript')
    expect.soft(mocks.status).toHaveBeenCalledWith(modelId, { language }, expect.any(AbortSignal))
    expect.soft(mocks.start).toHaveBeenCalledWith(
      {
        modelId,
        input: { kind: TranscriptionInputKind.Audio, audio: wav },
        output: TranscriptionOutputKind.Final,
        options: { language }
      },
      expect.any(AbortSignal)
    )
  })

  it('propagates rejected explicit locale selection for automatic-detection models', async () => {
    environment = { platform: 'linux', arch: 'x64' }
    mocks.preferences.mockReturnValue({ modelId: FUNASR_MODEL_ID, language: 'ja-JP' })
    await expect(transcribeChannelAudio(input)).rejects.toMatchObject({ reason: 'invalid_request' })
    expect(mocks.status).not.toHaveBeenCalled()
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it.each([
    ['AuTo', 'ja-JP', TranscriptionLanguageSource.Interface],
    ['auto', 'ja-JP', TranscriptionLanguageSource.Interface],
    [' ', 'ja-JP', TranscriptionLanguageSource.Interface],
    [' de-DE ', 'de-DE', TranscriptionLanguageSource.Explicit]
  ])('normalizes recognition language %j', async (storedLanguage, language, source) => {
    mocks.preferences.mockReturnValue({ modelId: APPLE_ASR_MODEL_ID, language: storedLanguage })
    await expect(transcribeChannelAudio(input)).resolves.toBe('transcript')
    expect.soft(mocks.status).toHaveBeenCalledWith(APPLE_ASR_MODEL_ID, { language }, expect.any(AbortSignal))
    expect.soft(mocks.start.mock.calls[0][0].options).toEqual({ language })
    expect(mocks.resolve).toHaveBeenCalledWith({ modelId: APPLE_ASR_MODEL_ID, language: { source, locale: language } })
  })

  it('reads interface language again for each transcription', async () => {
    await expect(transcribeChannelAudio(input)).resolves.toBe('transcript')
    interfaceLanguage = 'de-DE'
    await expect(transcribeChannelAudio(input)).resolves.toBe('transcript')
    expect.soft(mocks.status.mock.calls[0][1]).toEqual({ language: 'ja-JP' })
    expect.soft(mocks.status.mock.calls[1][1]).toEqual({ language: 'de-DE' })
    expect.soft(mocks.start.mock.calls[0][0].options).toEqual({ language: 'ja-JP' })
    expect.soft(mocks.start.mock.calls[1][0].options).toEqual({ language: 'de-DE' })
  })

  it('waits for execution-owned cleanup before returning trimmed text', async () => {
    const closed = deferred<void>()
    mocks.start.mockReturnValue({ completed: Promise.resolve(result()), closed: closed.promise, cancel: vi.fn() })
    let settled = false
    const task = transcribeChannelAudio(input).then((value) => {
      settled = true
      return value
    })
    await flush()
    expect(settled).toBe(false)
    closed.resolve()
    await expect(task).resolves.toBe('transcript')
  })

  it('rejects empty transcription and cancels the execution', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    mocks.start.mockReturnValue({ completed: Promise.resolve({ text: '  ' }), closed: Promise.resolve(), cancel })
    await expect(transcribeChannelAudio(input)).rejects.toBeDefined()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects noncanonical decoder output before starting inference', async () => {
    mocks.decode.mockResolvedValue({ wav: input.audio })
    await expect(transcribeChannelAudio(input)).rejects.toBeDefined()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.dispose).toHaveBeenCalledTimes(1)
  })

  it('aborts status at the deadline and waits for its settlement without starting decode', async () => {
    const status = deferred<{ status: string }>()
    mocks.status.mockReturnValue(status.promise)
    let settled = false
    const task = transcribeChannelAudio(input)
    const rejected = expect(task).rejects.toBeDefined()
    void task.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.status.mock.calls[0][2].aborted).toBe(true)
    expect(settled).toBe(false)
    status.resolve({ status: 'ready' })
    await rejected
    expect(mocks.createInstance).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it.each([0, 45_000])('terminates decoding at the earlier deadline after %i ms of status work', async (delay) => {
    const status = deferred<{ status: string }>()
    const decoded = deferred<{ wav: Uint8Array }>()
    const disposed = deferred<void>()
    mocks.status.mockReturnValue(status.promise)
    mocks.decode.mockReturnValue(decoded.promise)
    mocks.dispose.mockReturnValue(disposed.promise)
    let settled = false
    const task = transcribeChannelAudio(input)
    const rejected = expect(task).rejects.toBeDefined()
    void task.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await vi.advanceTimersByTimeAsync(delay)
    status.resolve({ status: 'ready' })
    await flush()
    await vi.advanceTimersByTimeAsync(Math.min(30_000, 60_000 - delay))
    expect(mocks.dispose).toHaveBeenCalledTimes(1)
    expect(mocks.decode.mock.calls[0][2].signal.aborted).toBe(true)
    expect(settled).toBe(false)
    decoded.resolve({ wav })
    await flush()
    expect(settled).toBe(false)
    disposed.resolve()
    await rejected
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it.each(['queue', 'inference'])('cancels %s at 60s, rejects late text, and waits for closed', async (phase) => {
    const completed = deferred<{ text: string }>()
    const closed = deferred<void>()
    const ready = deferred<void>()
    const cancelled = deferred<void>()
    const cancel = vi.fn(() => {
      ready.resolve()
      return cancelled.promise
    })
    mocks.start.mockReturnValue({ completed: completed.promise, closed: closed.promise, ready: ready.promise, cancel })
    let settled = false
    const task = transcribeChannelAudio(input)
    const rejected = expect(task).rejects.toBeDefined()
    void task.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await flush()
    if (phase === 'inference') ready.resolve()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.start.mock.calls[0][1].aborted).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(mocks.dispose).toHaveBeenCalledTimes(1)
    completed.resolve({ text: 'late transcript' })
    cancelled.resolve()
    await flush()
    expect(settled).toBe(false)
    closed.resolve()
    await rejected
  })

  it('rejects timely text when closed crosses the work deadline', async () => {
    const closed = deferred<void>()
    const cancel = vi.fn().mockResolvedValue(undefined)
    mocks.start.mockReturnValue({ completed: Promise.resolve(result()), closed: closed.promise, cancel })
    let settled = false
    const task = transcribeChannelAudio(input)
    const rejected = expect(task).rejects.toBeDefined()
    void task.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)
    closed.resolve()
    await rejected
  })

  it.each(['decode', 'execution'])('observes %s failure and releases owned resources', async (phase) => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    if (phase === 'decode') mocks.decode.mockRejectedValue(new Error('decode failed'))
    else
      mocks.start.mockImplementation(() => ({
        completed: Promise.reject(new Error('inference failed')),
        closed: Promise.resolve(),
        cancel
      }))
    await expect(transcribeChannelAudio(input)).rejects.toThrow(`${phase === 'decode' ? 'decode' : 'inference'} failed`)
    expect(mocks.dispose).toHaveBeenCalledTimes(1)
    if (phase === 'execution') expect(cancel).toHaveBeenCalledTimes(1)
    else expect(mocks.start).not.toHaveBeenCalled()
  })

  it('does not start work for an already cancelled caller', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(transcribeChannelAudio(input, controller.signal)).rejects.toBeDefined()
    expect(mocks.status).not.toHaveBeenCalled()
    expect(mocks.createInstance).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'closed', 'dispose'])('observes rejected %s cleanup and reports failure', async (failure) => {
    const unhandled: unknown[] = []
    const listener = (error: unknown) => unhandled.push(error)
    process.on('unhandledRejection', listener)
    const completed = deferred<{ text: string }>()
    const closed = deferred<void>()
    const cancel = vi.fn().mockImplementation(() => {
      completed.reject(new Error('cancelled'))
      if (failure === 'closed') closed.reject(new Error('cleanup failed'))
      else closed.resolve()
      return failure === 'cancel' ? Promise.reject(new Error('cancel failed')) : Promise.resolve()
    })
    mocks.start.mockReturnValue({ completed: completed.promise, closed: closed.promise, cancel })
    if (failure === 'dispose') mocks.dispose.mockRejectedValue(new Error('dispose failed'))
    const task = transcribeChannelAudio(input)
    const rejected = expect(task).rejects.toMatchObject({ reason: 'operation_failed' })
    try {
      await vi.advanceTimersByTimeAsync(60_000)
      await rejected
      expect(unhandled).toEqual([])
    } finally {
      process.removeListener('unhandledRejection', listener)
    }
  })

  it('propagates caller cancellation immediately to the independent decoder', async () => {
    const decoded = deferred<{ wav: Uint8Array }>()
    mocks.decode.mockReturnValue(decoded.promise)
    const controller = new AbortController()
    const task = transcribeChannelAudio(input, controller.signal)
    const rejected = expect(task).rejects.toBeDefined()
    await flush()
    controller.abort()
    expect(mocks.dispose).toHaveBeenCalledTimes(1)
    decoded.reject(new Error('terminated'))
    await rejected
    expect(mocks.start).not.toHaveBeenCalled()
  })
})
