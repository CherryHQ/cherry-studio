import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { defaultServiceInstances } from '@test-mocks/main/application'
import { session } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { voiceHandlers } from '@main/ipc/handlers/voice'
import { MediaProtocolService } from '@main/services/mediaProtocol'
import { APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID } from '@shared/ai/localVoice'
import { voiceRequestSchemas, type VoiceSessionEvent } from '@shared/ipc/schemas/voice'
import type { InputFor, OutputFor } from '@shared/ipc/types'

import type * as LocalAdapters from '../localAdapters'
import { VoiceRuntimeError } from '../VoiceRuntimeError'
import { VoiceSessionService, type VoiceOwner } from '../VoiceSessionService'

// Pending synthesis takes the inspection lock before admission, so a manual read or
// dictation never reaches the displacement Main already allows.
const native = vi.hoisted(() => ({
  speech: vi.fn(),
  resolveSpeech: vi.fn(),
  resolveTranscription: vi.fn(),
  releases: [] as Array<() => void>
}))

vi.hoisted(() => {
  Object.assign(globalThis, { window: new EventTarget() })
})

vi.mock('../localAdapters', async (importOriginal) => {
  const actual = await importOriginal<typeof LocalAdapters>()
  return {
    ...actual,
    resolveSpeechConfiguration: (...args: Parameters<typeof actual.resolveSpeechConfiguration>) =>
      native.resolveSpeech(...args),
    resolveTranscriptionConfiguration: (...args: Parameters<typeof actual.resolveTranscriptionConfiguration>) =>
      native.resolveTranscription(...args),
    getLocalVoiceStatus: vi.fn(async () => ({ status: 'ready' })),
    listLocalVoices: vi.fn(async () => []),
    installVoiceLocale: vi.fn(async () => undefined),
    voiceAudioProcess: { id: 'voice.audio' }
  }
})
vi.mock('@renderer/data/PreferenceService', () => ({
  preferenceService: { get: vi.fn(), getMultiple: vi.fn() }
}))
vi.mock('@renderer/i18n/resolver', () => ({
  default: { language: 'en-US', resolvedLanguage: 'en-US' }
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn(), on: vi.fn(() => () => undefined) }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { DictationService } = await import('@renderer/services/voice/DictationService')
const { SpeechPlaybackService } = await import('@renderer/services/voice/SpeechPlaybackService')
const { VoiceService } = await import('@renderer/services/voice/VoiceService')

const managedWindows = new Map<string, { webContents: VoiceOwner['webContents']; type: WindowType }>()
const powerEvents = new EventEmitter()
const clientListeners: Array<Set<(event: VoiceSessionEvent) => void>> = []

function deliver(event: VoiceSessionEvent): void {
  for (const listeners of clientListeners) {
    for (const listener of [...listeners]) listener(event)
  }
}

function owner(): VoiceOwner {
  const events = new EventEmitter()
  const result = {
    windowId: randomUUID(),
    webContents: Object.assign(events, {
      id: Math.random(),
      isDestroyed: () => false
    }) as unknown as VoiceOwner['webContents']
  }
  managedWindows.set(result.windowId, { webContents: result.webContents, type: WindowType.Main })
  return result
}

function wav() {
  const data = Buffer.alloc(46)
  data.write('RIFF')
  data.writeUInt32LE(38, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(16000, 24)
  data.writeUInt32LE(32000, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(2, 40)
  return data
}

class FakeAudio extends EventTarget {
  src = ''
  paused = true
  currentTime = 0
  removeAttribute(name: string) {
    if (name === 'src') this.src = ''
  }
  load() {}
  play = () => {
    this.paused = false
    return Promise.resolve()
  }
  pause = () => {
    this.paused = true
  }
}

function fakeRecorder(resetOnStop = true) {
  const recorder = {
    state: 'inactive' as 'inactive' | 'recording',
    ondataavailable: null as ((event: { data: Blob }) => void) | null,
    onstop: null as (() => void) | null,
    start() {
      recorder.state = 'recording'
    },
    stop() {
      if (resetOnStop) recorder.state = 'inactive'
      recorder.onstop?.()
    }
  }
  return recorder
}

function readySpeech(input: { modelId?: string; voice?: string; language?: string; speed?: number } = {}) {
  return {
    modelId: input.modelId ?? APPLE_TTS_MODEL_ID,
    voice: input.voice ?? 'exact',
    language: input.language ?? 'en-US',
    speed: input.speed ?? 1,
    status: { status: 'ready' as const }
  }
}

describe('voice admission coordination through the renderer coordinators', () => {
  let rootService: VoiceSessionService
  let media: MediaProtocolService
  let speechSpeed = 1
  let tempDirectory = ''
  const cleanups: Array<() => Promise<void>> = []

  beforeEach(async () => {
    vi.stubGlobal(
      'process',
      Object.defineProperties(Object.create(process), {
        platform: { value: 'darwin' },
        arch: { value: 'arm64' },
        getSystemVersion: { value: () => '26.3' }
      })
    )
    BaseService.resetInstances()
    managedWindows.clear()
    clientListeners.length = 0
    powerEvents.removeAllListeners()
    cleanups.length = 0
    speechSpeed = 1
    tempDirectory = mkdtempSync(path.join(tmpdir(), 'voice-admission-'))
    native.releases.length = 0
    Object.assign(session.defaultSession, {
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn()
    })
    native.speech.mockReset().mockImplementation((_model, _text, _options, signal: AbortSignal) => {
      return new Promise((resolve, reject) => {
        const fail = () => reject(new Error('The operation was aborted'))
        if (signal?.aborted) {
          fail()
          return
        }
        signal?.addEventListener('abort', fail, { once: true })
        native.releases.push(() => {
          signal?.removeEventListener('abort', fail)
          resolve({ audio: wav(), mediaType: 'audio/wav' })
        })
      })
    })
    native.resolveSpeech.mockReset().mockImplementation(async (input) => readySpeech(input))
    native.resolveTranscription.mockReset().mockImplementation(async (input) => ({
      modelId: input?.modelId ?? APPLE_ASR_MODEL_ID,
      language: input?.language,
      status: { status: 'ready' }
    }))
    media = new MediaProtocolService()
    const runtime = {
      broadcastToType: vi.fn((type: WindowType, channel: string, event: VoiceSessionEvent) => {
        if (type === WindowType.Main && channel === 'ai.voice.session_event') deliver(event)
      }),
      send: vi.fn((_windowId: string, channel: string, event: VoiceSessionEvent) => {
        if (channel === 'ai.voice.session_event') deliver(event)
      })
    }
    vi.mocked(application.get).mockImplementation(((name: string) => {
      if (name === 'VoiceSessionService') return rootService
      if (name === 'MediaProtocolService') return media
      if (name === 'AiService') return { generateSpeech: native.speech, transcribe: vi.fn() }
      if (name === 'UtilityProcessManager') return { register: vi.fn() }
      if (name === 'IpcApiService') return runtime
      if (name === 'WindowManager')
        return {
          getWindow: (id: string) => {
            const managed = managedWindows.get(id)
            return managed
              ? { webContents: managed.webContents, isDestroyed: () => managed.webContents.isDestroyed() }
              : undefined
          },
          getWindowType: (id: string) => managedWindows.get(id)?.type,
          getWindowIdByWebContents: (contents: VoiceOwner['webContents']) =>
            [...managedWindows].find(([, managed]) => managed.webContents === contents)?.[0]
        }
      if (name === 'PowerService')
        return {
          onSuspend: (listener: () => void) => {
            powerEvents.on('suspend', listener)
            return { dispose: () => powerEvents.removeListener('suspend', listener) }
          },
          onResume: (listener: () => void) => {
            powerEvents.on('resume', listener)
            return { dispose: () => powerEvents.removeListener('resume', listener) }
          },
          onLockScreen: (listener: () => void) => {
            powerEvents.on('lock', listener)
            return { dispose: () => powerEvents.removeListener('lock', listener) }
          },
          onUnlockScreen: (listener: () => void) => {
            powerEvents.on('unlock', listener)
            return { dispose: () => powerEvents.removeListener('unlock', listener) }
          },
          preventSleep: () => ({ dispose: () => undefined })
        }
      return defaultServiceInstances[name as keyof typeof defaultServiceInstances]
    }) as typeof application.get)
    vi.mocked(application.getPath).mockImplementation((key, filename) => {
      const directory = key === 'feature.voice.temp' ? tempDirectory : tmpdir()
      return filename ? `${directory}/${filename}` : directory
    })
    rootService = new VoiceSessionService()
    await rootService._doInit()
  })

  afterEach(async () => {
    await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()))
    await rootService._doStop()
    rmSync(tempDirectory, { recursive: true, force: true })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function createPlayback(voiceOwner = owner()) {
    const listeners = new Set<(event: VoiceSessionEvent) => void>()
    clientListeners.push(listeners)
    const ipc = {
      request: async <R extends keyof typeof voiceRequestSchemas>(
        route: R,
        ...args: InputFor<R> extends void ? [] : [input: InputFor<R>]
      ): Promise<OutputFor<R>> => {
        const parsed = voiceRequestSchemas[route].input.parse(args[0]) as InputFor<R>
        return voiceHandlers[route](parsed, { senderId: voiceOwner.windowId })
      },
      on: (_event: 'ai.voice.session_event', callback: (payload: VoiceSessionEvent) => void): (() => void) => {
        listeners.add(callback)
        return () => {
          listeners.delete(callback)
        }
      }
    }
    const voice = new VoiceService({
      ipc,
      ownerWindow: new EventTarget() as Window,
      createId: randomUUID,
      readSpeechPreferences: async () => ({
        modelId: APPLE_TTS_MODEL_ID,
        voice: 'exact',
        language: 'en-US',
        speed: speechSpeed
      }),
      readTranscriptionPreferences: async () => ({
        modelId: APPLE_ASR_MODEL_ID,
        language: 'en-US'
      })
    })
    const audios: FakeAudio[] = []
    const playback = new SpeechPlaybackService({
      voice,
      ownerWindow: new EventTarget() as Window,
      createAudio: (url) => {
        const audio = new FakeAudio()
        audio.src = url
        audios.push(audio)
        return audio as unknown as HTMLAudioElement
      }
    })
    cleanups.push(() => playback.teardown())
    return { playback, voice, voiceOwner, audios, ipc }
  }

  function startPending(playback: InstanceType<typeof SpeechPlaybackService>, sourceEntityId: string) {
    const started = playback.start({
      text: `read ${sourceEntityId}`,
      trigger: 'manual',
      sourceLabel: 'message',
      sourceEntityId
    })
    let rejected: unknown
    started.catch((error: unknown) => {
      rejected = error
    })
    return vi
      .waitFor(() => {
        if (rejected) throw rejected
        expect(native.speech).toHaveBeenCalledTimes(1)
      })
      .then(() => ({ started }))
  }

  it('replaces pending native synthesis when another window starts a manual read', async () => {
    const first = createPlayback()
    const second = createPlayback()
    const { started } = await startPending(first.playback, 'message-1')

    const replacement = second.playback.start({
      text: 'replacement sentence',
      trigger: 'manual',
      sourceLabel: 'message',
      sourceEntityId: 'message-2'
    })
    await vi.waitFor(() => expect(native.speech).toHaveBeenCalledTimes(2))
    native.releases[1]?.()

    await expect(started).rejects.toMatchObject({ reason: 'aborted' })
    await expect(replacement).resolves.toEqual({ status: 'started' })
    expect(native.speech.mock.calls[1]?.[2]).toMatchObject({ voice: 'exact', language: 'en-US' })
    expect(rootService.getState(second.voiceOwner)).toMatchObject({ phase: 'playing', trigger: 'manual' })
  })

  it('lets dictation from another window preempt pending native synthesis', async () => {
    const first = createPlayback()
    const dictationOwner = owner()
    const { voice } = createPlayback(dictationOwner)
    const tracks = [{ stop: vi.fn(), onended: null }]
    const getUserMedia = vi.fn(async () => ({ getTracks: () => tracks }) as unknown as MediaStream)
    const dictation = new DictationService({
      voice,
      targets: {
        captureCurrent: () => null,
        insert: () => 'unavailable',
        insertIntoCurrent: () => 'unavailable'
      },
      mediaDevices: { getUserMedia },
      createMediaRecorder: () => fakeRecorder(),
      readMicrophoneDeviceId: async () => null,
      clipboard: { writeText: async () => undefined }
    })
    cleanups.push(() => dictation.teardown())
    const { started } = await startPending(first.playback, 'message-1')

    const recording = dictation.start()
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false }))
    await recording

    await expect(started).rejects.toMatchObject({ reason: 'aborted' })
    expect(native.speech).toHaveBeenCalledTimes(1)
    expect(dictation.getSnapshot().phase).toBe('recording')
    expect(rootService.getState(dictationOwner)).toMatchObject({ phase: 'recording', source: 'dictation' })
  })

  it('does not let automatic reading preempt pending synthesis or an active recording', async () => {
    const { playback, voiceOwner } = createPlayback()
    const { started } = await startPending(playback, 'message-1')

    await expect(
      playback.start({
        text: 'automatic follow up',
        trigger: 'auto_read',
        sourceLabel: 'message',
        sourceEntityId: 'message-2'
      })
    ).rejects.toMatchObject({ reason: 'busy' })
    expect(native.speech).toHaveBeenCalledTimes(1)
    expect(rootService.getState(voiceOwner).phase).not.toBe('idle')

    native.releases[0]?.()
    await started
    await playback.stop()
    const dictationOwner = owner()
    const dictationVoice = createPlayback(dictationOwner).voice
    const dictation = new DictationService({
      voice: dictationVoice,
      targets: {
        captureCurrent: () => null,
        insert: () => 'unavailable',
        insertIntoCurrent: () => 'unavailable'
      },
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream)
      },
      createMediaRecorder: () => fakeRecorder(false),
      readMicrophoneDeviceId: async () => null,
      clipboard: { writeText: async () => undefined }
    })
    cleanups.push(() => dictation.teardown())
    await dictation.start()
    await expect(
      playback.start({
        text: 'manual during recording',
        trigger: 'manual',
        sourceLabel: 'message',
        sourceEntityId: 'message-3'
      })
    ).rejects.toMatchObject({ reason: 'busy' })
    expect(rootService.getState(dictationOwner)).toMatchObject({ phase: 'recording' })
    expect(native.speech).toHaveBeenCalledTimes(1)
  })

  it.each(['abort', 'remote-stop', 'teardown', 'power', 'paused-power'] as const)(
    'allows the same preview consumer to restart after configuration is cancelled by %s',
    async (mode) => {
      let releaseConfiguration!: (value: ReturnType<typeof readySpeech>) => void
      native.resolveSpeech.mockImplementationOnce(
        (_input, signal: AbortSignal) =>
          new Promise((resolve, reject) => {
            const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            if (signal?.aborted) {
              fail()
              return
            }
            signal?.addEventListener('abort', fail, { once: true })
            releaseConfiguration = (value) => {
              signal?.removeEventListener('abort', fail)
              resolve(value)
            }
          })
      )
      const { playback, voiceOwner } = createPlayback()
      const observer = createPlayback()
      await observer.voice.initialize()
      const controller = new AbortController()
      const started = playback.start({
        text: 'configure me',
        trigger: 'manual',
        sourceLabel: 'preview',
        sourceEntityId: 'voice-settings',
        signal: controller.signal
      })
      const cancelled = started.catch((error: unknown) => error)
      await vi.waitFor(() => expect(native.resolveSpeech).toHaveBeenCalled())
      const state = observer.voice.getSnapshot()
      expect(state).toMatchObject({
        phase: 'generating',
        playback: { availableCommands: expect.arrayContaining(['stop']) }
      })
      if (state.phase === 'idle') throw new Error('Missing pending playback session')

      if (mode === 'abort') controller.abort()
      else if (mode === 'remote-stop') {
        await observer.voice.controlPlayback({ sessionId: state.sessionId, command: 'stop' })
      } else if (mode === 'teardown') await playback.teardown()
      else {
        if (mode === 'paused-power') {
          await observer.voice.controlPlayback({ sessionId: state.sessionId, command: 'pause' })
          await vi.waitFor(() => expect(rootService.getState(voiceOwner).phase).toBe('paused'))
        }
        powerEvents.emit('suspend')
      }
      releaseConfiguration?.(readySpeech())

      await expect(cancelled).resolves.toMatchObject({ reason: 'aborted' })
      expect(native.speech).not.toHaveBeenCalled()
      expect(rootService.getState(voiceOwner)).toMatchObject({ phase: 'idle' })
      expect(playback.getSnapshot()).toMatchObject({ phase: 'idle' })

      const next = playback.start({
        text: 'next preview',
        trigger: 'manual',
        sourceLabel: 'preview',
        sourceEntityId: 'voice-settings'
      })
      await vi.waitFor(() => expect(native.speech).toHaveBeenCalledOnce())
      native.releases[0]?.()
      await expect(next).resolves.toEqual({ status: 'started' })
      expect(rootService.getState(voiceOwner)).toMatchObject({ phase: 'playing', trigger: 'manual' })
      expect(playback.getSnapshot()).toMatchObject({ phase: 'playing', sourceLabel: 'preview' })
    }
  )

  it('aborts only the matching speech request during preference resolution', async () => {
    let signal: AbortSignal | undefined
    native.resolveSpeech.mockImplementationOnce(
      (_input, active: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal = active
          active.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
    )
    const voiceOwner = owner()
    const input = {
      sessionId: randomUUID(),
      requestId: randomUUID(),
      text: 'configure me',
      preferenceResolution: true as const,
      speed: 1,
      trigger: 'manual' as const
    }
    const started = rootService.speech(voiceOwner, input)
    await vi.waitFor(() => expect(signal?.aborted).toBe(false))

    await rootService.abort(voiceOwner, { ...input, requestId: randomUUID() }, 'speech')
    await rootService.abort(voiceOwner, input, 'transcription')
    await expect(rootService.abort(owner(), input, 'speech')).rejects.toMatchObject({ reason: 'forbidden_owner' })
    expect(signal?.aborted).toBe(false)
    expect(native.speech).not.toHaveBeenCalled()

    await rootService.abort(voiceOwner, input, 'speech')
    await expect(started).rejects.toMatchObject({ reason: 'aborted' })
    expect(native.speech).not.toHaveBeenCalled()
    expect(rootService.getState(voiceOwner)).toMatchObject({ phase: 'idle' })
  })

  it.each(['preparing', 'paused'] as const)(
    'releases an unstarted %s playback when an inspection outlives configuration',
    async (phase) => {
      let releaseConfiguration!: (value: ReturnType<typeof readySpeech>) => void
      native.resolveSpeech.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseConfiguration = resolve
          })
      )
      const { playback, voice, voiceOwner } = createPlayback()
      const started = playback.start({
        text: 'configure me',
        trigger: 'manual',
        sourceLabel: 'preview',
        sourceEntityId: 'preview'
      })
      const failed = expect(started).rejects.toMatchObject({ reason: 'busy' })
      await vi.waitFor(() => expect(native.resolveSpeech).toHaveBeenCalledTimes(1))
      if (phase === 'paused') await playback.pause()

      let releaseInspection!: (value: ReturnType<typeof readySpeech>) => void
      native.resolveSpeech.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseInspection = resolve
          })
      )
      const inspection = voice.resolveSpeechConfiguration({ speed: 1 })
      await vi.waitFor(() => expect(native.resolveSpeech).toHaveBeenCalledTimes(2))
      releaseConfiguration(readySpeech())
      const install = {
        sessionId: randomUUID(),
        requestId: randomUUID(),
        modelId: APPLE_ASR_MODEL_ID,
        language: 'en-US'
      }
      try {
        await failed
        expect(rootService.getState(voiceOwner).phase).toBe('idle')
        expect(playback.getSnapshot()).toMatchObject({ phase: 'failed', error: 'busy' })
        await expect(rootService.installAsset(voiceOwner, install)).rejects.toMatchObject({ reason: 'busy' })
      } finally {
        releaseInspection(readySpeech())
        await inspection
      }
      await expect(rootService.installAsset(voiceOwner, install)).resolves.toBeUndefined()
      native.speech.mockResolvedValue({ audio: wav(), mediaType: 'audio/wav' })
      await playback.start({ text: 'restart', trigger: 'manual', sourceLabel: 'preview', sourceEntityId: 'preview' })
      expect(playback.getSnapshot().phase).toBe('playing')
      await playback.stop()
    }
  )

  it('retains an admitted busy synthesis failure until the same consumer stops it', async () => {
    native.speech.mockRejectedValueOnce(new VoiceRuntimeError('busy'))
    const { playback, voiceOwner } = createPlayback()
    await expect(
      playback.start({ text: 'start', trigger: 'manual', sourceLabel: 'preview', sourceEntityId: 'preview' })
    ).rejects.toMatchObject({ reason: 'busy' })
    expect(rootService.getState(voiceOwner)).toMatchObject({
      phase: 'failed',
      playback: { failure: { stage: 'synthesis' } }
    })
    expect(playback.getSnapshot()).toMatchObject({ phase: 'failed', error: 'busy' })
    await playback.stop()
    expect(rootService.getState(voiceOwner).phase).toBe('idle')
    expect(playback.getSnapshot().phase).toBe('idle')
  })

  it.each(['inspection', 'synthesis'] as const)(
    'exposes failure during %s between chunks and lets the same consumer stop and restart',
    async (stage) => {
      native.speech.mockResolvedValue({ audio: wav(), mediaType: 'audio/wav' })
      const { playback, voice, voiceOwner, audios } = createPlayback()
      await playback.start({
        text: 'A sentence to read aloud. '.repeat(180),
        trigger: 'manual',
        sourceLabel: 'document',
        sourceEntityId: 'long-document'
      })
      expect(playback.getSnapshot()).toMatchObject({ phase: 'playing', progress: { completed: 0, total: 2 } })

      const gate = Promise.withResolvers<ReturnType<typeof readySpeech>>()
      let inspection: Promise<unknown> = Promise.resolve()
      if (stage === 'inspection') {
        native.resolveSpeech.mockReturnValueOnce(gate.promise)
        inspection = voice.resolveSpeechConfiguration({ speed: 1 })
        await vi.waitFor(() => expect(native.resolveSpeech).toHaveBeenCalledTimes(2))
      } else {
        native.speech.mockRejectedValueOnce(new Error('native synthesis failed'))
      }

      try {
        audios[0].dispatchEvent(new Event('ended'))
        const reason = stage === 'inspection' ? 'busy' : 'operation_failed'
        await vi.waitFor(() => expect(playback.getSnapshot()).toMatchObject({ phase: 'failed', error: reason }))
        expect(rootService.getState(voiceOwner)).toMatchObject({
          phase: 'failed',
          playback: {
            failure: { stage: stage === 'inspection' ? 'playback' : 'synthesis', reason },
            availableCommands: ['stop']
          }
        })
        expect(audios[0].src).toBe('')
        expect(playback.getSnapshot().progress).toEqual({ completed: 1, total: 2 })
      } finally {
        gate.resolve(readySpeech())
        await inspection
      }

      await playback.stop()
      expect(rootService.getState(voiceOwner).phase).toBe('idle')
      expect(playback.getSnapshot().phase).toBe('idle')
      await playback.start({
        text: 'Read again after the failure.',
        trigger: 'manual',
        sourceLabel: 'message',
        sourceEntityId: 'restarted-message'
      })
      expect(playback.getSnapshot().phase).toBe('playing')
      audios.at(-1)!.dispatchEvent(new Event('ended'))
      await vi.waitFor(() => expect(playback.getSnapshot().phase).toBe('idle'))
      expect(rootService.getState(voiceOwner).phase).toBe('idle')
    }
  )

  it.each(['pause', 'stop', 'replacement'] as const)(
    'settles a rejected continuation after %s without reviving obsolete playback',
    async (action) => {
      native.speech.mockResolvedValue({ audio: wav(), mediaType: 'audio/wav' })
      const { playback, voice, voiceOwner, audios, ipc } = createPlayback()
      await playback.start({
        text: 'A sentence to read aloud. '.repeat(180),
        trigger: 'manual',
        sourceLabel: 'document',
        sourceEntityId: 'long-document'
      })

      const gate = Promise.withResolvers<ReturnType<typeof readySpeech>>()
      native.resolveSpeech.mockReturnValueOnce(gate.promise)
      const inspection = voice.resolveSpeechConfiguration({ speed: 1 })
      await vi.waitFor(() => expect(native.resolveSpeech).toHaveBeenCalledTimes(2))
      const rejected = Promise.withResolvers<void>()
      const response = Promise.withResolvers<void>()
      const generate = vi.spyOn(voice, 'generateSpeech')
      const request = ipc.request
      ipc.request = async (route, ...args) => {
        try {
          return await request(route, ...args)
        } catch (error) {
          if (route === 'ai.speech.generate') {
            rejected.resolve()
            await response.promise
          }
          throw error
        }
      }

      try {
        audios[0].dispatchEvent(new Event('ended'))
        await rejected.promise
        gate.resolve(readySpeech())
        await inspection
        if (action === 'replacement') {
          await playback.start({
            text: 'The replacement must remain audible.',
            trigger: 'manual',
            sourceLabel: 'message',
            sourceEntityId: 'replacement-message'
          })
        } else {
          await playback[action]()
        }
        response.resolve()
        await expect(generate.mock.results[0].value.result).rejects.toMatchObject({ reason: 'busy' })
        if (action === 'pause') {
          await vi.waitFor(() => expect(playback.getSnapshot()).toMatchObject({ phase: 'failed', error: 'busy' }))
          expect(rootService.getState(voiceOwner)).toMatchObject({ phase: 'failed' })
          await playback.stop()
        } else if (action === 'replacement') {
          expect(playback.getSnapshot()).toMatchObject({ phase: 'playing', sourceLabel: 'message' })
          expect(audios.at(-1)!.paused).toBe(false)
          await playback.stop()
        }
        await vi.waitFor(() => expect(playback.getSnapshot().phase).toBe('idle'))
        expect(rootService.getState(voiceOwner).phase).toBe('idle')
        expect(audios.every((audio) => audio.src === '')).toBe(true)
      } finally {
        gate.resolve(readySpeech())
        response.resolve()
        await inspection
      }
    }
  )

  it('stops the displaced playback when replacement configuration has no usable voice', async () => {
    const first = createPlayback()
    const second = createPlayback()
    const { started } = await startPending(first.playback, 'message-1')
    native.resolveSpeech.mockResolvedValueOnce({
      modelId: APPLE_TTS_MODEL_ID,
      speed: 1,
      status: { status: 'not_installed', reason: 'voice_unavailable' }
    })

    const replacement = second.playback.start({
      text: 'missing voice',
      trigger: 'manual',
      sourceLabel: 'preview',
      sourceEntityId: 'preview-1'
    })

    await expect(replacement).rejects.toMatchObject({ reason: 'voice_unavailable' })
    await expect(started).rejects.toMatchObject({ reason: 'aborted' })
    expect(native.speech).toHaveBeenCalledTimes(1)
    expect(rootService.getState(second.voiceOwner)).toMatchObject({ phase: 'idle' })
  })

  it('rejects an invalid stored speed before a manual read can displace playback', async () => {
    const { playback, voiceOwner } = createPlayback()
    const { started } = await startPending(playback, 'message-1')
    speechSpeed = Number.NaN

    await expect(
      playback.start({
        text: 'bad speed',
        trigger: 'manual',
        sourceLabel: 'message',
        sourceEntityId: 'message-2'
      })
    ).rejects.toMatchObject({ reason: 'invalid_request' })

    expect(native.speech).toHaveBeenCalledTimes(1)
    expect(rootService.getState(voiceOwner).phase).not.toBe('idle')
    native.releases[0]?.()
    await started
  })
})
