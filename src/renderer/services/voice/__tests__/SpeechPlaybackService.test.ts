import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SpeechPlaybackService, type SpeechPlaybackStartInput } from '../SpeechPlaybackService'
import { VoiceDomainError, type VoiceService } from '../VoiceService'

const sessionId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000002'
class FakeAudio extends EventTarget {
  src = ''
  removeAttribute(name: string) {
    if (name === 'src') this.src = ''
  }
  load() {}
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
  readonly readSpeechPreferenceInput = vi.fn(
    async (): ReturnType<VoiceService['readSpeechPreferenceInput']> => ({
      modelId: 'local-voice::apple-system-tts' as const,
      voice: 'configured-voice',
      language: 'zh-CN',
      speed: 0.75
    })
  )
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
        output: { id: `file-${index}`, url: 'cherry-media://audio/output', mimeType: 'audio/wav' }
      })
    }
  })
  readonly abortSpeech = vi.fn(async () => undefined)
  readonly releaseOutput = vi.fn(async ({ outputId }: any) => {
    this.events.push(`release:${outputId}`)
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
  private readonly interruptionListeners = new Set<() => void>()
  readonly subscribeCommands = vi.fn((listener: (event: any) => void): (() => void) => {
    this.commandListeners.add(listener)
    return () => this.commandListeners.delete(listener)
  })
  readonly subscribeInterruptions = (listener: () => void): (() => void) => {
    this.interruptionListeners.add(listener)
    return () => this.interruptionListeners.delete(listener)
  }

  emitInterruption(): void {
    this.interruptionListeners.forEach((listener) => listener())
  }

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

function createHarness(options: { chunks?: string[]; audio?: FakeAudio } = {}) {
  const voice = new FakeVoiceService()
  const ownerWindow = new EventTarget() as Window
  const audios: FakeAudio[] = []
  const createAudio = vi.fn((url: string) => {
    voice.events.push(`create-audio:${url}`)
    const audio = options.audio ?? new FakeAudio()
    audio.src = url
    audios.push(audio)
    return audio as unknown as HTMLAudioElement
  })
  const service = new SpeechPlaybackService({
    voice: voice as never,
    ownerWindow,
    createAudio,
    ...(options.chunks && {
      planText: () => ({ status: 'ready' as const, normalizedLength: 10, chunks: options.chunks! })
    })
  })
  return { service, voice, ownerWindow, audios, createAudio }
}

beforeEach(() => vi.restoreAllMocks())

describe('SpeechPlaybackService planning and playback', () => {
  it.each(['initialize', 'readSpeechPreferenceInput'] as const)(
    'cancels a source while waiting for %s',
    async (stage) => {
      const { service, voice } = createHarness()
      const controller = new AbortController()
      let resolve!: (value: any) => void
      voice[stage].mockReturnValueOnce(new Promise<any>((done) => (resolve = done)))
      const starting = service.start({ ...baseInput, signal: controller.signal })
      const aborted = expect(starting).rejects.toMatchObject({ reason: 'aborted' })
      await vi.waitFor(() => expect(voice[stage]).toHaveBeenCalled())
      controller.abort()
      resolve({ modelId: 'local-voice::apple-system-tts', voice: 'configured-voice', speed: 1 })
      await aborted
      expect(voice.generateSpeech).not.toHaveBeenCalled()
      expect(service.getSnapshot().phase).toBe('idle')
    }
  )

  it('keeps the resolved voice for all chunks and refreshes it for the next playback', async () => {
    const { service, voice, audios } = createHarness({ chunks: ['first', 'second'] })
    voice.readSpeechPreferenceInput.mockResolvedValue({
      modelId: 'local-voice::apple-system-tts',
      language: 'zh-CN',
      speed: 1
    })
    let defaultVoice = 'tingting'
    const synthesizedVoices: string[] = []
    voice.generateSpeech.mockImplementation((input) => {
      const selected = input.voice || defaultVoice
      synthesizedVoices.push(selected)
      return {
        sessionId,
        requestId,
        result: Promise.resolve({
          sessionId,
          requestId,
          resolved: { modelId: 'local-voice::apple-system-tts', voice: selected, language: 'zh-CN', speed: 1 },
          output: { id: `file-${synthesizedVoices.length}`, url: 'cherry-media://audio/output', mimeType: 'audio/wav' }
        })
      }
    })
    await service.start(baseInput)
    defaultVoice = 'eddy'
    audios[0].dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(audios).toHaveLength(2))
    expect(synthesizedVoices).toEqual(['tingting', 'tingting'])
    await service.stop()
    await service.start(baseInput)
    expect(synthesizedVoices).toEqual(['tingting', 'tingting', 'eddy'])
    await service.stop()
  })

  it('releases audio that ends before Main acknowledges playback and completes each chunk once', async () => {
    const { service, voice, audios } = createHarness({ chunks: ['first', 'second'] })
    let acknowledge!: () => void
    voice.updatePlayback.mockImplementationOnce(
      () => new Promise<any>((done) => (acknowledge = () => done({ phase: 'playing' })))
    )
    const starting = service.start(baseInput)
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'))
    audios[0].dispatchEvent(new Event('ended'))
    audios[0].dispatchEvent(new Event('ended'))
    acknowledge()
    await starting
    await vi.waitFor(() => expect(audios).toHaveLength(2))
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
    audios[1].dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('idle'))
    expect(voice.events.filter((event) => event.startsWith('release:'))).toEqual(['release:file-1', 'release:file-2'])
    expect(voice.updatePlayback).toHaveBeenCalledWith({ sessionId, phase: 'completed' })
  })

  it('cancels active playback and detaches cancellation after completion', async () => {
    const { service, voice, audios } = createHarness()
    const controller = new AbortController()
    await service.start({ ...baseInput, signal: controller.signal })
    controller.abort()
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('idle'))
    expect(audios[0].paused).toBe(true)
    expect(audios[0].src).toBe('')
    expect(voice.discardSession).toHaveBeenCalledWith(sessionId)
    await service.start(baseInput)
    expect(service.getSnapshot().phase).toBe('playing')
    await service.stop()
  })

  it('invalidates a start waiting for preferences when Main reports a power interruption', async () => {
    const { service, voice } = createHarness()
    let resolve!: (value: any) => void
    voice.readSpeechPreferenceInput.mockReturnValueOnce(new Promise<any>((done) => (resolve = done)))
    const starting = service.start(baseInput)
    const aborted = expect(starting).rejects.toMatchObject({ reason: 'aborted' })
    await vi.waitFor(() => expect(voice.readSpeechPreferenceInput).toHaveBeenCalled())

    voice.emitInterruption()
    resolve({ modelId: 'local-voice::apple-system-tts', voice: 'configured-voice', speed: 1 })
    await aborted

    expect(voice.generateSpeech).not.toHaveBeenCalled()
    expect(service.getSnapshot().phase).toBe('idle')
  })

  it('keeps generated audio paused when power interrupts before the owned pause command arrives', async () => {
    const { service, voice, audios } = createHarness()
    let resolve!: (value: any) => void
    voice.generateSpeech.mockImplementationOnce(() => ({
      sessionId,
      requestId,
      result: new Promise<any>((done) => (resolve = done))
    }))
    const starting = service.start(baseInput)
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))

    voice.emitInterruption()
    resolve({
      sessionId,
      requestId,
      output: { id: 'file-1', url: 'cherry-media://audio/output', mimeType: 'audio/wav' }
    })
    await starting

    expect(audios[0].play).not.toHaveBeenCalled()
    expect(service.getSnapshot().phase).toBe('paused')
    expect(voice.updatePlayback).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'playing' }))
    await service.stop()
  })

  it('uses centrally resolved speech preferences instead of caller parameters', async () => {
    const { service, voice } = createHarness()

    await service.start(baseInput)

    expect(voice.readSpeechPreferenceInput).toHaveBeenCalledOnce()
    expect(voice.generateSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'local-voice::apple-system-tts',
        voice: 'configured-voice',
        language: 'zh-CN',
        speed: 0.75,
        preferenceResolution: true,
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

  it('plays a media URL and generates the next chunk only after audio detachment and release on ended', async () => {
    const harness = createHarness({ chunks: ['first', 'second'] })
    await harness.service.start(baseInput)

    expect(harness.voice.generateSpeech).toHaveBeenCalledTimes(1)
    expect(harness.audios[0].src).toBe('cherry-media://audio/output')

    harness.audios[0].dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(harness.voice.generateSpeech).toHaveBeenCalledTimes(2))

    expect(harness.voice.events).toEqual([
      'generate:first',
      'create-audio:cherry-media://audio/output',
      'release:file-1',
      'generate:second',
      'create-audio:cherry-media://audio/output'
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

  it('does not play or regenerate the current chunk when paused during synthesis', async () => {
    const { service, voice, audios } = createHarness()
    let finishRead!: () => void
    voice.generateSpeech.mockImplementationOnce(() => ({
      sessionId,
      requestId,
      result: new Promise<any>((resolve) => {
        finishRead = () =>
          resolve({
            sessionId,
            requestId,
            output: { id: 'output', url: 'cherry-media://audio/output', mimeType: 'audio/wav' }
          })
      })
    }))
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

  it('does not report playing again when Main pauses and resumes during synthesis', async () => {
    const { service, voice, audios } = createHarness()
    let finishRead!: () => void
    voice.generateSpeech.mockImplementationOnce(() => ({
      sessionId,
      requestId,
      result: new Promise<any>((resolve) => {
        finishRead = () =>
          resolve({
            sessionId,
            requestId,
            output: { id: 'output', url: 'cherry-media://audio/output', mimeType: 'audio/wav' }
          })
      })
    }))
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

  it('pauses audio, detaches its URL, and discards retained output on explicit stop', async () => {
    const { service, voice, audios } = createHarness()
    await service.start(baseInput)

    await service.stop()
    await vi.waitFor(() => expect(voice.discardSession).toHaveBeenCalledWith(sessionId))

    expect(voice.discardSession).toHaveBeenCalledTimes(1)
    expect(audios[0].pause).toHaveBeenCalledTimes(1)
    expect(audios[0].src).toBe('')
    expect(service.getSnapshot().phase).toBe('idle')
  })

  it.each(['play', 'acknowledgment'])('preserves audio failure during pending %s and allows retry', async (stage) => {
    const audio = new FakeAudio()
    const { service, voice } = createHarness({ audio })
    let finish!: () => void
    if (stage === 'play') {
      audio.play.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
    } else {
      voice.updatePlayback.mockImplementationOnce(
        () =>
          new Promise<any>((resolve) => {
            finish = () => resolve({ phase: 'playing' })
          })
      )
    }
    const result = service.start(baseInput).catch((error: unknown) => error)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    audio.dispatchEvent(new Event('error'))
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('failed'))
    finish()
    expect(await result).toMatchObject({ reason: 'operation_failed' })
    expect(service.getSnapshot().phase).toBe('failed')
    expect(service.canRetry(sessionId)).toBe(true)
    await service.retry()
    expect(service.getSnapshot().phase).toBe('playing')
    expect(audio.paused).toBe(false)
    expect(voice.generateSpeech).toHaveBeenCalledTimes(1)
    await service.stop()
  })

  it('retains failed audio for explicit retry without generating again', async () => {
    const { service, voice, audios } = createHarness()
    await service.start(baseInput)
    audios[0].currentTime = 7

    audios[0].dispatchEvent(new Event('error'))
    await vi.waitFor(() => expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'operation_failed' }))

    expect(voice.releaseOutput).not.toHaveBeenCalled()
    expect(audios[0].src).toBe('cherry-media://audio/output')
    expect(service.canRetry(sessionId)).toBe(true)
    expect(service.canRetry('another-session')).toBe(false)
    await service.retry()

    expect(service.canRetry(sessionId)).toBe(false)
    expect(service.getSnapshot().phase).toBe('playing')
    expect(audios[0].currentTime).toBe(7)
    expect(audios[0].play).toHaveBeenCalledTimes(2)
    expect(voice.generateSpeech).toHaveBeenCalledTimes(1)
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

  it('does not replace a visible snapshot when a new start fails local validation', async () => {
    const { service, voice } = createHarness()
    await service.start(baseInput)
    const originalSnapshot = service.getSnapshot()

    voice.readSpeechPreferenceInput.mockRejectedValueOnce(new VoiceDomainError('voice_unavailable'))
    await expect(service.start({ ...baseInput, sourceLabel: 'preview' })).rejects.toMatchObject({
      reason: 'voice_unavailable'
    })

    expect(service.getSnapshot()).toEqual(originalSnapshot)
    await service.pause()
    expect(voice.controlPlayback).toHaveBeenLastCalledWith({ sessionId, command: 'pause' })
  })

  it('detaches the player before release and discards ownership if release fails', async () => {
    const { service, voice, audios } = createHarness()
    await service.start(baseInput)
    voice.releaseOutput.mockImplementationOnce(async () => {
      expect(audios[0].src).toBe('')
      expect(audios[0].paused).toBe(true)
      throw new VoiceDomainError('operation_failed')
    })
    audios[0].dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'operation_failed' }))
    expect(voice.discardSession).toHaveBeenCalledWith(sessionId)
    expect(service.canRetry(sessionId)).toBe(false)
  })

  it('discards terminal ownership when completed update fails after final output release', async () => {
    const { service, voice, audios } = createHarness()
    voice.updatePlayback.mockResolvedValueOnce({ revision: 1, phase: 'playing', sessionId })
    voice.updatePlayback.mockRejectedValueOnce(new VoiceDomainError('operation_failed'))
    await service.start(baseInput)

    audios[0].dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'operation_failed' }))

    expect(voice.releaseOutput).toHaveBeenCalledTimes(1)
    expect(audios[0].src).toBe('')
    expect(voice.discardSession).toHaveBeenCalledWith(sessionId)
    expect(service.canRetry(sessionId)).toBe(false)
    await expect(service.retry()).rejects.toMatchObject({ reason: 'invalid_request' })
    expect(audios[0].play).toHaveBeenCalledTimes(1)
  })

  it('retains cleanup ownership after discard failure and retries it on a later stop', async () => {
    const { service, voice, audios } = createHarness()
    voice.discardSession.mockRejectedValueOnce(new VoiceDomainError('operation_failed'))
    await service.start(baseInput)

    await expect(service.stop()).rejects.toMatchObject({ reason: 'operation_failed' })
    expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'operation_failed' })
    expect(service.canRetry(sessionId)).toBe(false)
    expect(audios[0].pause).toHaveBeenCalledTimes(1)
    expect(audios[0].src).toBe('')

    await service.stop()
    expect(voice.discardSession).toHaveBeenCalledTimes(2)
    expect(audios[0].src).toBe('')
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
    voice.readSpeechPreferenceInput.mockRejectedValueOnce(new VoiceDomainError('voice_unavailable'))

    await expect(service.start(baseInput)).rejects.toMatchObject({
      reason: 'voice_unavailable'
    })

    expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'voice_unavailable' })
    expect(voice.generateSpeech).not.toHaveBeenCalled()
  })

  it('ignores visibility changes but terminates audio and retained output on beforeunload', async () => {
    const { service, voice, ownerWindow, audios } = createHarness()
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
    expect(audios[0].src).toBe('')
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
          output: { id: 'new-output', url: 'cherry-media://audio/output', mimeType: 'audio/wav' }
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
        output: { id: 'new-output', url: 'cherry-media://audio/output', mimeType: 'audio/wav' }
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

  it('stays paused and can resume when pause rejects the pending play promise', async () => {
    const audio = new FakeAudio()
    let rejectPlay!: (error: unknown) => void
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPlay = reject
        })
    )
    const { service, voice } = createHarness({ audio })
    const starting = service.start(baseInput)
    await vi.waitFor(() => expect(rejectPlay).toBeTypeOf('function'))

    voice.emitCommand('pause')
    rejectPlay(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'))
    await starting

    expect(service.getSnapshot()).toMatchObject({ phase: 'paused' })
    expect(service.getSnapshot().error).toBeUndefined()
    expect(voice.updatePlayback).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'failed' }))
    expect(voice.updatePlayback).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'playing' }))
    expect(service.canRetry(sessionId)).toBe(false)

    voice.emitCommand('resume')
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(audio.paused).toBe(false)
    expect(voice.updatePlayback).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'failed' }))
  })

  it('fails playback when a pending play rejects without an intentional pause', async () => {
    const audio = new FakeAudio()
    let rejectPlay!: (error: unknown) => void
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPlay = reject
        })
    )
    const { service, voice } = createHarness({ audio })
    const starting = service.start(baseInput)
    await vi.waitFor(() => expect(rejectPlay).toBeTypeOf('function'))

    const failure = expect(starting).rejects.toMatchObject({ reason: 'operation_failed' })
    rejectPlay(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'))
    await failure

    expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'operation_failed' })
    expect(voice.updatePlayback).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'failed', reason: 'operation_failed' })
    )
    expect(service.canRetry(sessionId)).toBe(true)
  })

  it('fails paused playback when the pending play rejects with a genuine audio error', async () => {
    const audio = new FakeAudio()
    let rejectPlay!: (error: unknown) => void
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPlay = reject
        })
    )
    const { service, voice } = createHarness({ audio })
    const starting = service.start(baseInput)
    await vi.waitFor(() => expect(rejectPlay).toBeTypeOf('function'))

    voice.emitCommand('pause')
    const failure = expect(starting).rejects.toMatchObject({ reason: 'operation_failed' })
    rejectPlay(new Error('decode failed'))
    await failure

    expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'operation_failed' })
    expect(voice.updatePlayback).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'failed', reason: 'operation_failed' })
    )
  })

  it('keeps a genuine audio failure when the paused play later rejects with AbortError', async () => {
    const audio = new FakeAudio()
    let rejectPlay!: (error: unknown) => void
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPlay = reject
        })
    )
    const { service, voice } = createHarness({ audio })
    const starting = service.start(baseInput)
    await vi.waitFor(() => expect(rejectPlay).toBeTypeOf('function'))

    voice.emitCommand('pause')
    audio.dispatchEvent(new Event('error'))
    await vi.waitFor(() => expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'operation_failed' }))
    const failure = expect(starting).rejects.toMatchObject({ reason: 'operation_failed' })
    rejectPlay(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'))
    await failure

    expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'operation_failed' })
    expect(voice.updatePlayback).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'failed', reason: 'operation_failed' })
    )
  })

  it('does not resolve a stopped or torn-down play as paused when the pending play aborts', async () => {
    const audio = new FakeAudio()
    let rejectPlay!: (error: unknown) => void
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPlay = reject
        })
    )
    const { service, voice } = createHarness({ audio })
    const starting = service.start(baseInput)
    await vi.waitFor(() => expect(rejectPlay).toBeTypeOf('function'))
    voice.emitCommand('pause')

    const stopping = service.stop()
    rejectPlay(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'))
    await expect(starting).rejects.toMatchObject({ reason: 'aborted' })
    await stopping
    expect(service.getSnapshot().phase).toBe('idle')
  })

  it('does not resolve teardown of a paused pending play as a successful pause', async () => {
    const audio = new FakeAudio()
    let rejectPlay!: (error: unknown) => void
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPlay = reject
        })
    )
    const { service, voice } = createHarness({ audio })
    const starting = service.start(baseInput)
    await vi.waitFor(() => expect(rejectPlay).toBeTypeOf('function'))
    voice.emitCommand('pause')

    const tearingDown = service.teardown()
    rejectPlay(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'))
    await expect(starting).rejects.toMatchObject({ reason: 'aborted' })
    await tearingDown
    expect(service.getSnapshot().phase).toBe('idle')
    expect(service.getSnapshot().error).toBeUndefined()
  })

  it('keeps text, bytes, URLs, paths, and session identifiers out of its public snapshot', async () => {
    const textCanary = 'PRIVATE_TRANSCRIPT_/secret/audio.wav'
    const { service } = createHarness({ chunks: [textCanary] })
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
