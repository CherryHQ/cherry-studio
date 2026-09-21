import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SpeechPlaybackService, type SpeechPlaybackStartInput } from '../SpeechPlaybackService'
import { VoiceDomainError } from '../VoiceService'

const sessionId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000002'
const wav = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 65, 86, 69])

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(reader.result as ArrayBuffer), { once: true })
    reader.addEventListener('error', () => reject(reader.error), { once: true })
    reader.readAsArrayBuffer(blob)
  })
}

class FakeAudio extends EventTarget {
  currentTime = 0
  paused = true
  readonly play = vi.fn(async () => {
    this.paused = false
  })
  readonly pause = vi.fn(() => {
    this.paused = true
  })
}

class FakeVoiceService {
  readonly events: string[] = []
  readonly initialize = vi.fn(async (): Promise<void> => undefined)
  readonly resolveSpeechPreferences = vi.fn(async () => ({
    modelId: 'local-voice::apple-system-tts' as const,
    voice: 'configured-voice',
    language: 'zh-CN',
    speed: 0.75
  }))
  readonly generateSpeech = vi.fn((input: any) => {
    const index = this.generateSpeech.mock.calls.length
    const id = input.sessionId ?? sessionId
    this.events.push(`generate:${input.text}`)
    return {
      sessionId: id,
      requestId,
      result: Promise.resolve({
        sessionId: id,
        requestId,
        fileEntry: { id: `file-${index}`, origin: 'internal' },
        mimeType: 'audio/wav'
      })
    }
  })
  readonly abortSpeech = vi.fn(async () => undefined)
  readonly readOutput = vi.fn(async () => ({ audio: wav, mimeType: 'audio/wav' as const }))
  readonly releaseOutput = vi.fn(async ({ fileEntryId }: any) => {
    this.events.push(`release:${fileEntryId}`)
  })
  readonly updatePlayback = vi.fn(async ({ sessionId: id, phase }: any) => ({
    revision: 1,
    phase: phase === 'completed' ? 'idle' : phase,
    ...(phase === 'completed' ? {} : { sessionId: id })
  }))
  readonly controlPlayback = vi.fn(async ({ sessionId: id, command }: any) => {
    this.commandListeners.forEach((listener) => listener({ type: 'command', revision: 1, sessionId: id, command }))
    return { revision: 1, phase: command === 'stop' ? 'idle' : command === 'pause' ? 'paused' : 'playing' }
  })
  readonly discardSession = vi.fn(async () => undefined)
  private readonly commandListeners = new Set<(event: any) => void>()
  readonly subscribeCommands = vi.fn((listener: (event: any) => void): (() => void) => {
    this.commandListeners.add(listener)
    return () => this.commandListeners.delete(listener)
  })

  emitCommand(command: 'pause' | 'resume' | 'stop'): void {
    this.commandListeners.forEach((listener) => listener({ type: 'command', revision: 1, sessionId, command }))
  }
}

const baseInput: SpeechPlaybackStartInput = {
  text: 'hello world',
  trigger: 'manual',
  sourceLabel: 'message',
  sourceEntityId: 'message-1'
}

function createHarness(options: { chunks?: string[]; objectUrl?: string; audio?: FakeAudio } = {}) {
  const voice = new FakeVoiceService()
  const ownerWindow = new EventTarget() as Window
  const audios: FakeAudio[] = []
  const createObjectURL = vi.fn((blob: Blob) => {
    voice.events.push('create-url')
    return options.objectUrl ?? `blob:voice-${blob.size}`
  })
  const revokeObjectURL = vi.fn((url: string) => voice.events.push(`revoke:${url}`))
  const createAudio = vi.fn((url: string) => {
    voice.events.push(`create-audio:${url}`)
    const audio = options.audio ?? new FakeAudio()
    audios.push(audio)
    return audio as unknown as HTMLAudioElement
  })
  const service = new SpeechPlaybackService({
    voice: voice as never,
    ownerWindow,
    createAudio,
    createObjectURL,
    revokeObjectURL,
    ...(options.chunks && {
      planText: () => ({ status: 'ready' as const, normalizedLength: 10, chunks: options.chunks! })
    })
  })
  return { service, voice, ownerWindow, audios, createAudio, createObjectURL, revokeObjectURL }
}

beforeEach(() => vi.restoreAllMocks())

describe('SpeechPlaybackService planning and playback', () => {
  it('uses centrally resolved speech preferences instead of caller parameters', async () => {
    const { service, voice } = createHarness()

    await service.start(baseInput)

    expect(voice.resolveSpeechPreferences).toHaveBeenCalledOnce()
    expect(voice.generateSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'local-voice::apple-system-tts',
        voice: 'configured-voice',
        language: 'zh-CN',
        speed: 0.75,
        sourceEntityId: 'message-1'
      })
    )
  })

  it('requires confirmation for long manual text and skips long auto text without Voice IPC', async () => {
    const manual = createHarness()
    const text = 'x'.repeat(5_001)

    await expect(manual.service.start({ ...baseInput, text })).resolves.toEqual({
      status: 'confirmation_required',
      normalizedLength: 5_001
    })
    expect(manual.voice.initialize).not.toHaveBeenCalled()
    expect(manual.voice.generateSpeech).not.toHaveBeenCalled()

    const automatic = createHarness()
    await expect(automatic.service.start({ ...baseInput, text, trigger: 'auto_read' })).resolves.toEqual({
      status: 'skipped',
      reason: 'too_long',
      normalizedLength: 5_001
    })
    expect(automatic.voice.initialize).not.toHaveBeenCalled()
    expect(automatic.voice.generateSpeech).not.toHaveBeenCalled()
  })

  it('continues confirmed long manual text through the same controller', async () => {
    const { service, voice } = createHarness()

    await expect(service.start({ ...baseInput, text: 'x'.repeat(5_001), confirmed: true })).resolves.toEqual({
      status: 'started'
    })

    expect(voice.generateSpeech).toHaveBeenCalledTimes(1)
  })

  it('plays WAV bytes and generates the next chunk only after release and URL revocation on ended', async () => {
    const harness = createHarness({ chunks: ['first', 'second'] })
    await harness.service.start(baseInput)

    expect(harness.voice.generateSpeech).toHaveBeenCalledTimes(1)
    const blob = harness.createObjectURL.mock.calls[0][0]
    expect(blob.type).toBe('audio/wav')
    await expect(readBlob(blob)).resolves.toEqual(wav.buffer)

    harness.audios[0].dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(harness.voice.generateSpeech).toHaveBeenCalledTimes(2))

    expect(harness.voice.events).toEqual([
      'generate:first',
      'create-url',
      'create-audio:blob:voice-12',
      'release:file-1',
      'revoke:blob:voice-12',
      'generate:second',
      'create-url',
      'create-audio:blob:voice-12'
    ])
  })

  it('preserves playback position and does not advance while paused', async () => {
    const { service, voice, audios } = createHarness({ chunks: ['first', 'second'] })
    await service.start(baseInput)
    audios[0].currentTime = 12.5

    await service.pause()
    audios[0].dispatchEvent(new Event('ended'))
    await Promise.resolve()

    expect(service.getSnapshot().phase).toBe('paused')
    expect(voice.generateSpeech).toHaveBeenCalledTimes(1)
    expect(audios[0].currentTime).toBe(12.5)

    await service.resume()
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
    expect(audios[0].currentTime).toBe(12.5)
    expect(audios[0].play).toHaveBeenCalledTimes(2)
  })

  it('does not play or regenerate the current chunk when paused during output read', async () => {
    const { service, voice, audios } = createHarness()
    let finishRead!: () => void
    voice.readOutput.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = () => resolve({ audio: wav, mimeType: 'audio/wav' as const })
        })
    )
    const starting = service.start(baseInput)
    await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'))

    voice.emitCommand('pause')
    finishRead()
    await starting

    expect(service.getSnapshot().phase).toBe('paused')
    expect(audios[0].play).not.toHaveBeenCalled()
    await service.resume()
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
    expect(audios[0].play).toHaveBeenCalledTimes(1)
    expect(voice.generateSpeech).toHaveBeenCalledTimes(1)
  })

  it('does not report playing again when Main pauses and resumes during output materialization', async () => {
    const { service, voice, audios } = createHarness()
    let finishRead!: () => void
    voice.readOutput.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = () => resolve({ audio: wav, mimeType: 'audio/wav' as const })
        })
    )
    const starting = service.start(baseInput)
    await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'))

    voice.emitCommand('pause')
    voice.emitCommand('resume')
    finishRead()
    await starting

    expect(audios[0].play).toHaveBeenCalledTimes(1)
    expect(service.getSnapshot().phase).toBe('playing')
    expect(voice.updatePlayback).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'playing' }))
  })

  it('continues with the next chunk when pause and resume both occur during output release', async () => {
    const { service, voice, audios } = createHarness({ chunks: ['first', 'second'] })
    let finishRelease!: () => void
    voice.releaseOutput.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRelease = resolve
        })
    )
    await service.start(baseInput)
    audios[0].dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(finishRelease).toBeTypeOf('function'))

    voice.emitCommand('pause')
    voice.emitCommand('resume')
    expect(voice.generateSpeech).toHaveBeenCalledTimes(1)
    finishRelease()

    await vi.waitFor(() => expect(voice.generateSpeech).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
  })

  it('aborts in-flight generation and discards the session on stop without requesting another chunk', async () => {
    const { service, voice } = createHarness({ chunks: ['first', 'second'] })
    let rejectGeneration!: (error: unknown) => void
    voice.generateSpeech.mockImplementationOnce((input: any) => ({
      sessionId: input.sessionId ?? sessionId,
      requestId,
      result: new Promise((_resolve, reject) => (rejectGeneration = reject))
    }))
    const starting = service.start(baseInput)
    const stopped = expect(starting).rejects.toMatchObject({ reason: 'aborted' })
    await vi.waitFor(() => expect(voice.generateSpeech).toHaveBeenCalledTimes(1))

    await service.stop()
    await vi.waitFor(() => expect(voice.abortSpeech).toHaveBeenCalledTimes(1))
    rejectGeneration(new VoiceDomainError('aborted'))
    await stopped

    expect(voice.discardSession).toHaveBeenCalledWith(sessionId)
    expect(voice.generateSpeech).toHaveBeenCalledTimes(1)
  })

  it('pauses audio, revokes its URL, and discards retained output on explicit stop', async () => {
    const { service, voice, audios, revokeObjectURL } = createHarness({ objectUrl: 'blob:retained' })
    await service.start(baseInput)

    await service.stop()
    await vi.waitFor(() => expect(voice.discardSession).toHaveBeenCalledWith(sessionId))

    expect(voice.discardSession).toHaveBeenCalledTimes(1)
    expect(audios[0].pause).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:retained')
    expect(service.getSnapshot().phase).toBe('idle')
  })

  it('retains failed audio for explicit retry without generating or reading again', async () => {
    const { service, voice, audios, revokeObjectURL } = createHarness()
    await service.start(baseInput)
    audios[0].currentTime = 7

    audios[0].dispatchEvent(new Event('error'))
    await vi.waitFor(() => expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'operation_failed' }))

    expect(voice.releaseOutput).not.toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    await service.retry()

    expect(audios[0].currentTime).toBe(7)
    expect(audios[0].play).toHaveBeenCalledTimes(2)
    expect(voice.generateSpeech).toHaveBeenCalledTimes(1)
    expect(voice.readOutput).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent retries into one audio play and one Main update', async () => {
    const { service, voice, audios } = createHarness()
    await service.start(baseInput)
    audios[0].dispatchEvent(new Event('error'))
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('failed'))
    voice.updatePlayback.mockClear()
    let finishPlay!: () => void
    audios[0].play.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPlay = resolve
        })
    )

    const first = service.retry()
    const second = service.retry()
    await vi.waitFor(() => expect(finishPlay).toBeTypeOf('function'))
    finishPlay()
    await Promise.all([first, second])

    expect(audios[0].play).toHaveBeenCalledTimes(2)
    expect(voice.updatePlayback.mock.calls.filter(([input]) => input.phase === 'playing')).toHaveLength(1)
  })

  it('keeps the visible session when a new auto-read admission is busy', async () => {
    const { service, voice } = createHarness()
    await service.start(baseInput)
    const originalSnapshot = service.getSnapshot()
    const rejectedSessionId = '00000000-0000-4000-8000-000000000099'
    voice.generateSpeech.mockImplementationOnce(() => ({
      sessionId: rejectedSessionId,
      requestId,
      result: Promise.reject(new VoiceDomainError('busy'))
    }))

    await expect(
      service.start({ ...baseInput, text: 'automatic follow-up', trigger: 'auto_read', sourceLabel: 'preview' })
    ).rejects.toMatchObject({ reason: 'busy' })

    expect(service.getSnapshot()).toEqual(originalSnapshot)
    expect(voice.discardSession).not.toHaveBeenCalledWith(rejectedSessionId)
    await service.pause()
    await service.stop()
    expect(voice.controlPlayback).toHaveBeenNthCalledWith(1, { sessionId, command: 'pause' })
    expect(voice.controlPlayback).toHaveBeenNthCalledWith(2, { sessionId, command: 'stop' })
  })

  it('stops only the currently visible auto-read run', async () => {
    const automatic = createHarness()
    await automatic.service.start({ ...baseInput, trigger: 'auto_read' })

    await expect(automatic.service.stopAutoRead()).resolves.toBe(true)
    expect(automatic.voice.controlPlayback).toHaveBeenCalledWith({ sessionId, command: 'stop' })
    expect(automatic.voice.discardSession).toHaveBeenCalledWith(sessionId)

    const manual = createHarness()
    await manual.service.start(baseInput)

    await expect(manual.service.stopAutoRead()).resolves.toBe(false)
    expect(manual.voice.controlPlayback).not.toHaveBeenCalled()
    expect(manual.voice.discardSession).not.toHaveBeenCalled()
    expect(manual.service.getSnapshot().phase).toBe('playing')
  })

  it('does not replace a visible snapshot when a new start fails local validation', async () => {
    const { service, voice } = createHarness()
    await service.start(baseInput)
    const originalSnapshot = service.getSnapshot()

    voice.resolveSpeechPreferences.mockRejectedValueOnce(new VoiceDomainError('voice_unavailable'))
    await expect(service.start({ ...baseInput, sourceLabel: 'preview' })).rejects.toMatchObject({
      reason: 'voice_unavailable'
    })

    expect(service.getSnapshot()).toEqual(originalSnapshot)
    await service.pause()
    expect(voice.controlPlayback).toHaveBeenLastCalledWith({ sessionId, command: 'pause' })
  })

  it('discards terminal ownership when completed update fails after final output release', async () => {
    const { service, voice, audios, revokeObjectURL } = createHarness({ objectUrl: 'blob:final' })
    voice.updatePlayback.mockResolvedValueOnce({ revision: 1, phase: 'playing', sessionId })
    voice.updatePlayback.mockRejectedValueOnce(new VoiceDomainError('operation_failed'))
    await service.start(baseInput)

    audios[0].dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'operation_failed' }))

    expect(voice.releaseOutput).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:final')
    expect(voice.discardSession).toHaveBeenCalledWith(sessionId)
    await expect(service.retry()).rejects.toMatchObject({ reason: 'invalid_request' })
    expect(audios[0].play).toHaveBeenCalledTimes(1)
  })

  it('retains cleanup ownership after discard failure and retries it on a later stop', async () => {
    const { service, voice, audios, revokeObjectURL } = createHarness({ objectUrl: 'blob:cleanup' })
    voice.discardSession.mockRejectedValueOnce(new VoiceDomainError('operation_failed'))
    await service.start(baseInput)

    await expect(service.stop()).rejects.toMatchObject({ reason: 'operation_failed' })
    expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'operation_failed' })
    expect(audios[0].pause).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)

    await service.stop()
    expect(voice.discardSession).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(service.getSnapshot().phase).toBe('idle')
  })

  it('rejects teardown on discard failure and retains the run for a successful teardown retry', async () => {
    const { service, voice } = createHarness()
    voice.discardSession.mockRejectedValueOnce(new VoiceDomainError('operation_failed'))
    await service.start(baseInput)

    await expect(service.teardown()).rejects.toMatchObject({ reason: 'operation_failed' })
    expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'operation_failed' })

    await service.teardown()
    expect(voice.discardSession).toHaveBeenCalledTimes(2)
    expect(service.getSnapshot().phase).toBe('idle')
  })
})

describe('SpeechPlaybackService ownership and lifecycle', () => {
  it('routes pause, resume, and stop controls for a Main session from a window that does not own audio', async () => {
    const { service, voice } = createHarness()

    await service.pause(sessionId)
    await service.resume(sessionId)
    await service.stop(sessionId)

    expect(voice.controlPlayback.mock.calls.map(([input]) => input)).toEqual([
      { sessionId, command: 'pause' },
      { sessionId, command: 'resume' },
      { sessionId, command: 'stop' }
    ])
  })

  it('fails with the stable missing-voice error and never selects a fallback', async () => {
    const { service, voice } = createHarness()
    voice.resolveSpeechPreferences.mockRejectedValueOnce(new VoiceDomainError('voice_unavailable'))

    await expect(service.start(baseInput)).rejects.toMatchObject({
      reason: 'voice_unavailable'
    })

    expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'voice_unavailable' })
    expect(voice.initialize).not.toHaveBeenCalled()
    expect(voice.generateSpeech).not.toHaveBeenCalled()
  })

  it('ignores visibility changes but terminates audio and retained output on beforeunload', async () => {
    const { service, voice, ownerWindow, audios, revokeObjectURL } = createHarness({ objectUrl: 'blob:retained' })
    await service.start(baseInput)

    ownerWindow.dispatchEvent(new Event('visibilitychange'))
    expect(audios[0].pause).not.toHaveBeenCalled()
    expect(service.getSnapshot().phase).toBe('playing')

    ownerWindow.dispatchEvent(new Event('beforeunload'))
    await vi.waitFor(() => {
      expect(voice.discardSession).toHaveBeenCalledWith(sessionId)
      expect(service.getSnapshot().phase).toBe('idle')
    })
    expect(audios[0].pause).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:retained')
  })

  it('does not materialize playback after beforeunload wins a pending initialization', async () => {
    const { service, voice, ownerWindow } = createHarness()
    let finishInitialization!: () => void
    voice.initialize.mockReturnValueOnce(new Promise<void>((resolve) => (finishInitialization = resolve)))
    const starting = service.start(baseInput)
    const stopped = expect(starting).rejects.toMatchObject({ reason: 'aborted' })
    await vi.waitFor(() => expect(finishInitialization).toBeTypeOf('function'))

    ownerWindow.dispatchEvent(new Event('beforeunload'))
    finishInitialization()
    await stopped

    expect(voice.generateSpeech).not.toHaveBeenCalled()
    expect(service.getSnapshot().phase).toBe('idle')
  })

  it('does not let a late initialization rejection clear or duplicate a newer initialization', async () => {
    const { service, voice } = createHarness()
    let rejectFirst!: (error: unknown) => void
    let finishSecond!: () => void
    voice.initialize
      .mockReturnValueOnce(new Promise<void>((_resolve, reject) => (rejectFirst = reject)))
      .mockReturnValueOnce(new Promise<void>((resolve) => (finishSecond = resolve)))
    const first = service.initialize()
    const firstFailure = expect(first).rejects.toThrow('late init failure')
    await service.teardown()
    const second = service.initialize()

    rejectFirst(new Error('late init failure'))
    await firstFailure
    expect(service.initialize()).toBe(second)
    expect(voice.initialize).toHaveBeenCalledTimes(2)
    expect(voice.subscribeCommands).toHaveBeenCalledTimes(2)

    finishSecond()
    await second
  })

  it('does not let an older generation failure replace a newer visible snapshot', async () => {
    const { service, voice } = createHarness()
    const oldSessionId = '00000000-0000-4000-8000-000000000010'
    const newSessionId = '00000000-0000-4000-8000-000000000011'
    let rejectOld!: (error: unknown) => void
    voice.generateSpeech
      .mockImplementationOnce(() => ({
        sessionId: oldSessionId,
        requestId,
        result: new Promise((_resolve, reject) => (rejectOld = reject))
      }))
      .mockImplementationOnce(() => ({
        sessionId: newSessionId,
        requestId,
        result: Promise.resolve({
          sessionId: newSessionId,
          requestId,
          fileEntry: { id: 'new-output', origin: 'internal' },
          mimeType: 'audio/wav'
        })
      }))
    const oldStart = service.start(baseInput)
    const oldFailure = expect(oldStart).rejects.toMatchObject({ reason: 'operation_failed' })
    await vi.waitFor(() => expect(rejectOld).toBeTypeOf('function'))

    await service.start({ ...baseInput, text: 'newer text', sourceLabel: 'selection' })
    rejectOld(new Error('old generation failed'))
    await oldFailure

    expect(service.getSnapshot()).toEqual({
      phase: 'playing',
      sourceLabel: 'selection',
      progress: { completed: 0, total: 1 }
    })
  })

  it('does not let an older completion failure replace a newer visible snapshot', async () => {
    const { service, voice, audios } = createHarness()
    const newSessionId = '00000000-0000-4000-8000-000000000012'
    let finishOldRelease!: () => void
    voice.releaseOutput.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishOldRelease = resolve
        })
    )
    voice.updatePlayback.mockImplementation(async ({ sessionId: id, phase }: any) => {
      if (id === sessionId && phase === 'completed') throw new VoiceDomainError('operation_failed')
      return { revision: 1, phase, sessionId: id }
    })
    await service.start(baseInput)
    audios[0].dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(finishOldRelease).toBeTypeOf('function'))
    voice.generateSpeech.mockImplementationOnce(() => ({
      sessionId: newSessionId,
      requestId,
      result: Promise.resolve({
        sessionId: newSessionId,
        requestId,
        fileEntry: { id: 'new-output', origin: 'internal' },
        mimeType: 'audio/wav'
      })
    }))

    await service.start({ ...baseInput, text: 'newer text', sourceLabel: 'document' })
    finishOldRelease()
    await vi.waitFor(() => expect(voice.discardSession).toHaveBeenCalledWith(sessionId))

    expect(service.getSnapshot()).toEqual({
      phase: 'playing',
      sourceLabel: 'document',
      progress: { completed: 0, total: 1 }
    })
  })

  it('obeys a Main pause command without any automatic resume', async () => {
    const { service, voice, ownerWindow, audios } = createHarness()
    await service.start(baseInput)

    voice.emitCommand('pause')
    ownerWindow.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()

    expect(audios[0].pause).toHaveBeenCalledTimes(1)
    expect(audios[0].play).toHaveBeenCalledTimes(1)
    expect(service.getSnapshot().phase).toBe('paused')
  })

  it('does not overwrite a Main pause command that arrives while audio play is pending', async () => {
    const audio = new FakeAudio()
    let finishPlay!: () => void
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPlay = () => {
            audio.paused = false
            resolve()
          }
        })
    )
    const { service, voice } = createHarness({ audio })
    const starting = service.start(baseInput)
    await vi.waitFor(() => expect(finishPlay).toBeTypeOf('function'))

    voice.emitCommand('pause')
    finishPlay()
    await starting

    expect(audio.paused).toBe(true)
    expect(service.getSnapshot().phase).toBe('paused')
    expect(voice.updatePlayback).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'playing' }))
  })

  it('keeps text, bytes, URLs, paths, and session identifiers out of its public snapshot', async () => {
    const textCanary = 'PRIVATE_TRANSCRIPT_/secret/audio.wav'
    const { service } = createHarness({ chunks: [textCanary], objectUrl: 'blob:PRIVATE_AUDIO_URL' })
    await service.start({ ...baseInput, text: textCanary })

    const serialized = JSON.stringify(service.getSnapshot())
    expect(service.getSnapshot()).toEqual({
      phase: 'playing',
      sourceLabel: 'message',
      progress: { completed: 0, total: 1 }
    })
    for (const canary of [textCanary, '/secret/audio.wav', 'PRIVATE_AUDIO_URL', sessionId, 'audio', 'url', 'path']) {
      expect(serialized).not.toContain(canary)
    }
  })
})
