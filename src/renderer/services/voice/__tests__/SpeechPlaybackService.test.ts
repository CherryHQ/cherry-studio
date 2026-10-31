import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { VoiceSessionState } from '@shared/ipc/schemas/voice'

import {
  applyPlaybackCommand,
  applyPlaybackReport,
  beginPlaybackSynthesis,
  completePlaybackSynthesis,
  createPlaybackSnapshot,
  createPlaybackState,
  playbackPhase,
  type PlaybackState
} from '../../../../main/ai/voice/playbackState'
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
  readonly duration = 30
  currentTime = 0
  get ended() {
    return this.currentTime === this.duration
  }
  paused = true
  readonly play = vi.fn(async () => {
    if (this.ended) this.currentTime = 0
    this.paused = false
  })
  readonly pause = vi.fn(() => {
    this.paused = true
  })
}

class FakeVoiceService {
  readonly events: string[] = []
  private playback = createPlaybackState()
  private snapshot: VoiceSessionState = { phase: 'idle', revision: 0 }
  private hasOutput = false
  private ownedSessionId = sessionId
  private readonly listeners = new Set<() => void>()
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  readonly getSnapshot = () => this.snapshot
  private publish(playback: PlaybackState): VoiceSessionState {
    this.playback = playback
    this.snapshot = {
      phase: playbackPhase(playback),
      revision: this.snapshot.revision + 1,
      sessionId: this.ownedSessionId,
      source: 'playback',
      playback: createPlaybackSnapshot(playback, this.hasOutput)
    }
    this.listeners.forEach((listener) => listener())
    return this.snapshot
  }
  private idle() {
    this.snapshot = { phase: 'idle', revision: this.snapshot.revision + 1 }
    this.listeners.forEach((listener) => listener())
    return this.snapshot
  }
  readonly startSpeech = (input: any) => {
    const operation = this.generateSpeech(input)
    if (this.snapshot.phase === 'idle' || this.ownedSessionId === operation.sessionId) {
      if (this.snapshot.phase === 'idle') this.playback = createPlaybackState()
      this.ownedSessionId = operation.sessionId
      this.publish(beginPlaybackSynthesis(this.playback))
    }
    return {
      ...operation,
      result: operation.result.then((result) => {
        if (this.ownedSessionId !== operation.sessionId) this.playback = createPlaybackState()
        this.ownedSessionId = operation.sessionId
        this.hasOutput = true
        this.publish(completePlaybackSynthesis(this.playback))
        return { ...result, playback: createPlaybackSnapshot(this.playback, true) }
      })
    }
  }
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
        output: { kind: 'audio', id: `file-${index}`, url: 'cherry-media://audio/output', mimeType: 'audio/wav' }
      })
    }
  })
  readonly abortSpeech = vi.fn(async () => undefined)
  readonly releaseOutput = vi.fn(async ({ outputId }: any) => {
    this.events.push(`release:${outputId}`)
    this.hasOutput = false
  })
  readonly reportPlayback = vi.fn(async (input: any): Promise<VoiceSessionState> => {
    if (input.sessionId !== this.ownedSessionId) throw new VoiceDomainError('invalid_request')
    const next = applyPlaybackReport(this.playback, input)
    if (next === this.playback) return this.snapshot
    if (input.phase === 'completed' || input.phase === 'stopped') return this.idle()
    return this.publish(next)
  })
  readonly controlPlayback = vi.fn(async ({ sessionId: id, command }: any) => {
    if (id !== this.ownedSessionId || this.snapshot.phase === 'idle') throw new VoiceDomainError('invalid_request')
    const next = applyPlaybackCommand(this.playback, command, this.hasOutput)
    if (next === this.playback) return this.snapshot
    this.publish(next)
    this.commandListeners.forEach((listener) =>
      listener({
        type: 'command',
        revision: this.snapshot.revision,
        sessionId: id,
        command,
        playback: createPlaybackSnapshot(next, this.hasOutput)
      })
    )
    return this.snapshot
  })
  readonly discardSession = vi.fn(async (id: string) => {
    if (id === this.ownedSessionId) this.idle()
  })
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
    if (this.snapshot.phase !== 'idle') void this.controlPlayback({ sessionId: this.ownedSessionId, command: 'pause' })
  }

  emitCommand(command: 'pause' | 'resume' | 'stop'): void {
    void this.controlPlayback({ sessionId: this.ownedSessionId, command })
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
    const audio = (audios.length === 0 && options.audio) || new FakeAudio()
    audio.src = url
    audios.push(audio)
    return audio as unknown as HTMLAudioElement
  })
  const service = new SpeechPlaybackService({
    voice: { ...voice, generateSpeech: voice.startSpeech } as never,
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
  it.each(['readSpeechPreferenceInput', 'initialize'] as const)(
    'cancels pending auto-read during %s when the preference is turned off',
    async (boundary) => {
      const { service, voice } = createHarness()
      let resolve!: (value: any) => void
      voice[boundary].mockReturnValueOnce(new Promise<any>((done) => (resolve = done)))
      const starting = service.start({ ...baseInput, trigger: 'auto_read' })
      const aborted = expect(starting).rejects.toMatchObject({ reason: 'aborted' })
      await vi.waitFor(() => expect(voice[boundary]).toHaveBeenCalled())

      await service.stopAutoRead()
      resolve({ modelId: 'local-voice::apple-system-tts', voice: 'configured-voice', speed: 1 })
      await aborted

      expect(voice.generateSpeech).not.toHaveBeenCalled()
      expect(service.getSnapshot().phase).toBe('idle')
      await expect(service.start(baseInput)).resolves.toEqual({ status: 'started' })
      await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
      await service.stop()
    }
  )

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
          output: {
            kind: 'audio',
            id: `file-${synthesizedVoices.length}`,
            url: 'cherry-media://audio/output',
            mimeType: 'audio/wav'
          }
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
    const nextChunk = Promise.withResolvers<void>()
    const generate = voice.generateSpeech.getMockImplementation()!
    voice.generateSpeech.mockImplementationOnce(generate).mockImplementationOnce((input) => {
      const operation = generate(input)
      return { ...operation, result: nextChunk.promise.then(() => operation.result) }
    })
    let acknowledge!: () => void
    voice.reportPlayback.mockImplementationOnce(
      () => new Promise<any>((done) => (acknowledge = () => done({ phase: 'playing' })))
    )
    const starting = service.start(baseInput)
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'))
    audios[0].dispatchEvent(new Event('ended'))
    audios[0].dispatchEvent(new Event('ended'))
    acknowledge()
    await starting
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('generating'))
    await service.pause()
    await service.resume()
    nextChunk.resolve()
    await vi.waitFor(() => expect(audios).toHaveLength(2))
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
    audios[1].dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('idle'))
    expect(voice.events.filter((event) => event.startsWith('release:'))).toEqual(['release:file-1', 'release:file-2'])
  })

  it('keeps a completed continuation detached while its output release is pending', async () => {
    const { service, voice, audios } = createHarness({ chunks: ['first', 'second', 'third'] })
    await service.start(baseInput)
    const acknowledgement = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const report = voice.reportPlayback.getMockImplementation()!
    voice.reportPlayback.mockImplementation(async (input) => {
      const state = await report(input)
      if (input.phase === 'playing' && audios.length === 2) await acknowledgement.promise
      return state
    })
    const releaseOutput = voice.releaseOutput.getMockImplementation()!
    voice.releaseOutput.mockImplementation(async (input) => {
      if (input.outputId === 'file-2') await release.promise
      await releaseOutput(input)
    })

    audios[0].dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(audios).toHaveLength(2))
    audios[1].dispatchEvent(new Event('ended'))
    acknowledgement.resolve()
    await vi.waitFor(() => expect(audios[1].src).toBe(''))
    await service.pause()
    await service.resume()
    expect(audios.every((audio) => audio.src === '')).toBe(true)

    release.resolve()
    await vi.waitFor(() =>
      expect(service.getSnapshot()).toMatchObject({ phase: 'playing', progress: { completed: 2 } })
    )
    audios.at(-1)!.dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('idle'))
    expect(voice.events.filter((event) => event.startsWith('generate:'))).toEqual([
      'generate:first',
      'generate:second',
      'generate:third'
    ])
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
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
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

  it('cancels a pending automatic output locally before waiting for Main cleanup', async () => {
    const { service, voice, audios } = createHarness()
    let resolveOutput!: (value: any) => void
    let resolveStop!: () => void
    voice.generateSpeech.mockImplementationOnce(() => ({
      sessionId,
      requestId,
      result: new Promise<any>((resolve) => (resolveOutput = resolve))
    }))
    const cleanup = new Promise<any>((resolve) => (resolveStop = () => resolve({})))
    voice.controlPlayback.mockReturnValueOnce(cleanup)
    voice.discardSession.mockReturnValueOnce(cleanup)
    const starting = service.start({ ...baseInput, trigger: 'auto_read' })
    const aborted = expect(starting).rejects.toMatchObject({ reason: 'aborted' })
    await vi.waitFor(() => expect(resolveOutput).toBeTypeOf('function'))

    const stopping = service.stopAutoRead()
    resolveOutput({
      sessionId,
      requestId,
      output: { kind: 'audio', id: 'output', url: 'cherry-media://audio/output', mimeType: 'audio/wav' }
    })
    await aborted
    resolveStop()
    await stopping

    expect(audios).toHaveLength(0)
    expect(voice.discardSession).toHaveBeenCalledWith(sessionId)
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
      output: { kind: 'audio', id: 'file-1', url: 'cherry-media://audio/output', mimeType: 'audio/wav' }
    })
    await starting

    expect(audios[0].play).not.toHaveBeenCalled()
    expect(service.getSnapshot().phase).toBe('paused')
    expect(voice.reportPlayback).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'playing' }))
    await service.stop()
  })

  it('cleans an aborted start without clearing playback started during cleanup', async () => {
    const { service, voice, audios } = createHarness()
    const generation = Promise.withResolvers<never>()
    voice.generateSpeech.mockReturnValueOnce({ sessionId, requestId, result: generation.promise })
    const starting = service.start({ ...baseInput, sourceLabel: 'preview' })
    const aborted = expect(starting).rejects.toMatchObject({ reason: 'aborted' })
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('generating'))
    await voice.discardSession(sessionId)

    const cleanup = Promise.withResolvers<void>()
    voice.discardSession.mockReturnValueOnce(cleanup.promise)
    generation.reject(new VoiceDomainError('aborted'))
    await vi.waitFor(() => expect(voice.discardSession).toHaveBeenCalledTimes(2))

    const nextSessionId = '00000000-0000-4000-8000-000000000015'
    const generateSpeech = voice.generateSpeech.getMockImplementation()!
    voice.generateSpeech.mockImplementationOnce((input) => generateSpeech({ ...input, sessionId: nextSessionId }))
    await service.start({ ...baseInput, sourceLabel: 'selection' })
    cleanup.resolve()
    await aborted

    expect(service.getSnapshot()).toMatchObject({ phase: 'playing', sourceLabel: 'selection' })
    expect(voice.getSnapshot()).toMatchObject({ phase: 'playing', sessionId: nextSessionId })
    expect(audios[0].paused).toBe(false)
    await service.stop()
    expect(service.getSnapshot().phase).toBe('idle')
  })

  it('allows Stop to retry failed cleanup after Main aborts a start and closes its session', async () => {
    const { service, voice } = createHarness()
    const generation = Promise.withResolvers<never>()
    voice.generateSpeech.mockReturnValueOnce({ sessionId, requestId, result: generation.promise })
    const starting = service.start({ ...baseInput, sourceLabel: 'preview' })
    const failed = expect(starting).rejects.toMatchObject({ reason: 'operation_failed' })
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('generating'))
    await voice.discardSession(sessionId)

    voice.discardSession.mockRejectedValueOnce(new VoiceDomainError('operation_failed'))
    generation.reject(new VoiceDomainError('aborted'))
    await failed
    expect(service.getSnapshot().phase).not.toBe('idle')

    await service.stop()
    expect(service.getSnapshot().phase).toBe('idle')
    await service.start({ ...baseInput, sourceLabel: 'preview' })
    expect(service.getSnapshot()).toMatchObject({ phase: 'playing', sourceLabel: 'preview' })
    await service.stop()
  })

  it('releases an aborted continuation after Main closes its session', async () => {
    const { service, voice, audios } = createHarness({ chunks: ['first', 'second'] })
    await service.start(baseInput)
    const generation = Promise.withResolvers<never>()
    voice.generateSpeech.mockReturnValueOnce({ sessionId, requestId, result: generation.promise })
    audios[0].dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('generating'))
    await voice.discardSession(sessionId)
    generation.reject(new VoiceDomainError('aborted'))

    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('idle'))
    expect(audios[0].src).toBe('')
    await service.start(baseInput)
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
    await service.stop()
  })

  it.each([false, true])(
    'cleans a rejected continuation when failure reporting rejects (cleanup fails: %s)',
    async (cleanupFails) => {
      const { service, voice, audios } = createHarness({ chunks: ['first', 'second'] })
      await service.start(baseInput)
      voice.generateSpeech.mockImplementationOnce(() => ({
        sessionId,
        requestId,
        result: Promise.reject(new VoiceDomainError('busy'))
      }))
      const report = voice.reportPlayback.getMockImplementation()!
      voice.reportPlayback.mockImplementation(async (input) => {
        if (input.phase === 'failed') throw new VoiceDomainError('invalid_request')
        return report(input)
      })
      if (cleanupFails) voice.discardSession.mockRejectedValueOnce(new VoiceDomainError('operation_failed'))
      audios[0].dispatchEvent(new Event('ended'))

      await vi.waitFor(() =>
        expect(service.getSnapshot()).toMatchObject({
          phase: 'failed',
          error: cleanupFails ? 'operation_failed' : 'busy'
        })
      )
      expect(audios[0].src).toBe('')
      if (cleanupFails) await service.stop()
      expect(voice.getSnapshot().phase).toBe('idle')
      await service.start(baseInput)
      await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
      await service.stop()
    }
  )

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

    expect(service.getSnapshot().phase).toBe('paused')
    expect(voice.generateSpeech).toHaveBeenCalledTimes(1)
    expect(audios[0].currentTime).toBe(12.5)

    await service.resume()
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
    expect(audios[0].currentTime).toBe(12.5)
    expect(audios[0].play).toHaveBeenCalledTimes(2)
  })

  it.each([{ chunks: ['first'] }, { chunks: ['first', 'second'] }])(
    'consumes an ended chunk even when pause arrives before its event ($chunks)',
    async ({ chunks }) => {
      const { service, voice, audios } = createHarness({ chunks })
      await service.start(baseInput)
      const finishedAudio = audios[0]
      finishedAudio.currentTime = finishedAudio.duration
      finishedAudio.paused = true

      await service.pause()
      finishedAudio.dispatchEvent(new Event('ended'))

      await vi.waitFor(() => expect(finishedAudio.src).toBe(''))
      await vi.waitFor(() => expect(voice.releaseOutput).toHaveBeenCalledWith({ sessionId, outputId: 'file-1' }))
      if (chunks.length === 1) {
        await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('idle'))
        expect(voice.getSnapshot().phase).toBe('idle')
        await expect(service.resume()).rejects.toMatchObject({ reason: 'invalid_request' })
      } else {
        await vi.waitFor(() =>
          expect(service.getSnapshot()).toMatchObject({ phase: 'paused', progress: { completed: 1, total: 2 } })
        )
        expect(voice.generateSpeech).toHaveBeenCalledTimes(1)
        await service.resume()
        await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
        expect(voice.generateSpeech).toHaveBeenLastCalledWith(
          expect.objectContaining({ text: 'second', chunkIndex: 1 })
        )
        expect(audios).toHaveLength(2)
        expect(audios[1].paused).toBe(false)
        await service.stop()
      }
      expect(finishedAudio.play).toHaveBeenCalledTimes(1)
    }
  )

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
            output: { kind: 'audio', id: 'output', url: 'cherry-media://audio/output', mimeType: 'audio/wav' }
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

  it('confirms actual playback when pause and resume arrive during synthesis', async () => {
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
            output: { kind: 'audio', id: 'output', url: 'cherry-media://audio/output', mimeType: 'audio/wav' }
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
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
    expect(voice.getSnapshot()).toMatchObject({ phase: 'playing', playback: { pendingCommand: null } })
  })

  it.each(['before', 'after'] as const)(
    'continues with the next chunk when resuming %s output release completes',
    async (resumeAt) => {
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
      if (resumeAt === 'before') voice.emitCommand('resume')
      expect(voice.generateSpeech).toHaveBeenCalledTimes(1)
      expect(audios).toHaveLength(1)
      finishRelease()

      if (resumeAt === 'after') {
        await vi.waitFor(() => expect(service.getSnapshot().progress.completed).toBe(1))
        expect(voice.getSnapshot()).toMatchObject({ phase: 'paused', playback: { pendingCommand: null } })
        expect(audios[0].src).toBe('')
        voice.emitCommand('resume')
      }

      await vi.waitFor(() => expect(voice.generateSpeech).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
      expect(audios).toHaveLength(2)
      expect(audios[1].paused).toBe(false)
      audios[1].dispatchEvent(new Event('ended'))
      await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('idle'))
    }
  )

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

    expect(voice.getSnapshot().phase).toBe('idle')
    expect(voice.generateSpeech).toHaveBeenCalledTimes(1)
  })

  it('pauses audio, detaches its URL, and discards retained output on explicit stop', async () => {
    const { service, voice, audios } = createHarness()
    await service.start(baseInput)

    await service.stop()
    await vi.waitFor(() => expect(voice.getSnapshot().phase).toBe('idle'))

    expect(voice.getSnapshot().phase).toBe('idle')
    expect(audios[0].pause).toHaveBeenCalledTimes(1)
    expect(audios[0].src).toBe('')
    expect(service.getSnapshot().phase).toBe('idle')
  })

  it.each(['play', 'acknowledgment'])('preserves audio failure during pending %s and allows retry', async (stage) => {
    const audio = new FakeAudio()
    const { service, voice, audios } = createHarness({ audio })
    let finish!: () => void
    if (stage === 'play') {
      audio.play.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
    } else {
      voice.reportPlayback.mockImplementationOnce(
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
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
    expect(audios.at(-1)?.paused).toBe(false)
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
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
    expect(audios[0].src).toBe('')
    expect(audios[1].currentTime).toBe(0)
    expect(audios[1].paused).toBe(false)
    expect(voice.generateSpeech).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent retries into one audio play and one Main update', async () => {
    const { service, voice, audios, createAudio } = createHarness()
    await service.start(baseInput)
    audios[0].dispatchEvent(new Event('error'))
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('failed'))
    voice.reportPlayback.mockClear()
    const retryAudio = new FakeAudio()
    createAudio.mockImplementationOnce(() => {
      audios.push(retryAudio)
      return retryAudio as unknown as HTMLAudioElement
    })
    let finishPlay!: () => void
    retryAudio.play.mockImplementationOnce(
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

    expect(audios).toHaveLength(2)
    expect(retryAudio.play).toHaveBeenCalledTimes(1)
    expect(voice.reportPlayback.mock.calls.filter(([input]) => input.phase === 'playing')).toHaveLength(1)
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

  it.each(['before', 'after'] as const)(
    'plays admitted auto-read when the preceding completion reply arrives %s synthesis',
    async (replyOrder) => {
      const { service, voice, audios } = createHarness()
      const completion = Promise.withResolvers<void>()
      const synthesis = Promise.withResolvers<void>()
      const nextSessionId = '00000000-0000-4000-8000-000000000013'
      const reportPlayback = voice.reportPlayback.getMockImplementation()!
      voice.reportPlayback.mockImplementation(async (input) => {
        const state = await reportPlayback(input)
        if (input.sessionId === sessionId && input.phase === 'completed') await completion.promise
        return state
      })
      await service.start(baseInput)
      audios[0].dispatchEvent(new Event('ended'))
      await vi.waitFor(() => expect(voice.getSnapshot().phase).toBe('idle'))

      const generateSpeech = voice.generateSpeech.getMockImplementation()!
      voice.generateSpeech.mockImplementationOnce((input) => {
        const operation = generateSpeech({ ...input, sessionId: nextSessionId })
        return { ...operation, result: synthesis.promise.then(() => operation.result) }
      })
      const starting = service.start({ ...baseInput, trigger: 'auto_read', sourceEntityId: 'message-2' })
      const started = expect(starting).resolves.toEqual({ status: 'started' })
      await vi.waitFor(() => expect(voice.getSnapshot()).toMatchObject({ sessionId: nextSessionId }))

      if (replyOrder === 'before') {
        completion.resolve()
        await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('idle'))
      }
      synthesis.resolve()
      await started
      expect(audios).toHaveLength(2)
      expect(audios[1].paused).toBe(false)
      await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
      completion.resolve()
      await service.pause()
      expect(service.getSnapshot().phase).toBe('paused')
      await service.resume()
      expect(audios[1].paused).toBe(false)
      audios[1].dispatchEvent(new Event('ended'))
      await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('idle'))
      expect(audios.every((audio) => audio.src === '')).toBe(true)
      expect(voice.getSnapshot().phase).toBe('idle')
    }
  )

  it.each(['playing', 'completed'] as const)(
    'discards an admitted auto-read superseded by a manual run that is %s',
    async (manualPhase) => {
      const { service, voice, audios } = createHarness()
      const completion = Promise.withResolvers<void>()
      const synthesis = Promise.withResolvers<void>()
      const autoSessionId = '00000000-0000-4000-8000-000000000014'
      const manualSessionId = '00000000-0000-4000-8000-000000000015'
      const generateSpeech = voice.generateSpeech.getMockImplementation()!
      const reportPlayback = voice.reportPlayback.getMockImplementation()!
      voice.reportPlayback.mockImplementation(async (input) => {
        const state = await reportPlayback(input)
        if (input.sessionId === sessionId && input.phase === 'completed') await completion.promise
        return state
      })
      await service.start(baseInput)
      audios[0].dispatchEvent(new Event('ended'))
      await vi.waitFor(() => expect(voice.getSnapshot().phase).toBe('idle'))
      voice.generateSpeech.mockImplementationOnce((input) => {
        const operation = generateSpeech({ ...input, sessionId: autoSessionId })
        return { ...operation, result: synthesis.promise.then(() => operation.result) }
      })
      const starting = service.start({ ...baseInput, trigger: 'auto_read' })
      const aborted = expect(starting).rejects.toMatchObject({ reason: 'aborted' })
      await vi.waitFor(() => expect(voice.generateSpeech).toHaveBeenCalledTimes(2))

      voice.generateSpeech.mockImplementationOnce((input) => generateSpeech({ ...input, sessionId: manualSessionId }))
      await service.start({ ...baseInput, sourceLabel: 'selection' })
      completion.resolve()
      if (manualPhase === 'completed') {
        audios[1].dispatchEvent(new Event('ended'))
        await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('idle'))
      }
      const manualSnapshot = service.getSnapshot()
      synthesis.resolve()
      await aborted

      expect(audios).toHaveLength(2)
      expect(service.getSnapshot()).toEqual(manualSnapshot)
      expect(audios[1].paused).toBe(manualPhase === 'completed')
      expect(voice.discardSession).toHaveBeenCalledWith(autoSessionId)
      expect(voice.abortSpeech).not.toHaveBeenCalledWith(expect.objectContaining({ sessionId: autoSessionId }))
    }
  )

  it('stops an owned auto-read run and leaves manual playback running', async () => {
    const automatic = createHarness()
    await automatic.service.start({ ...baseInput, trigger: 'auto_read' })

    await expect(automatic.service.stopAutoRead()).resolves.toBe(true)
    expect(automatic.voice.discardSession).toHaveBeenCalledWith(sessionId)
    expect(automatic.service.getSnapshot().phase).toBe('idle')

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

    voice.readSpeechPreferenceInput.mockRejectedValueOnce(new VoiceDomainError('voice_unavailable'))
    await expect(service.start({ ...baseInput, sourceLabel: 'preview' })).rejects.toMatchObject({
      reason: 'voice_unavailable'
    })

    expect(service.getSnapshot()).toEqual(originalSnapshot)
    await service.pause()
    expect(voice.controlPlayback).toHaveBeenLastCalledWith({ sessionId, command: 'pause' })
  })

  it('detaches the player before release and reports a release failure while retaining recovery ownership', async () => {
    const { service, voice, audios } = createHarness()
    await service.start(baseInput)
    voice.releaseOutput.mockImplementationOnce(async () => {
      expect(audios[0].src).toBe('')
      expect(audios[0].paused).toBe(true)
      throw new VoiceDomainError('operation_failed')
    })
    audios[0].dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'operation_failed' }))
    expect(voice.getSnapshot()).toMatchObject({ phase: 'failed' })
    await service.stop()
    expect(voice.getSnapshot().phase).toBe('idle')
  })

  it('discards terminal ownership when completed update fails after final output release', async () => {
    const { service, voice, audios } = createHarness()
    const reportPlayback = voice.reportPlayback.getMockImplementation()!
    voice.reportPlayback.mockImplementation(async (input) => {
      if (input.phase === 'completed') throw new VoiceDomainError('operation_failed')
      return reportPlayback(input)
    })
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

  it('retains cleanup ownership after stop confirmation failure and retries it on a later stop', async () => {
    const { service, voice, audios } = createHarness()
    await service.start(baseInput)
    voice.reportPlayback.mockRejectedValueOnce(new VoiceDomainError('operation_failed'))

    await expect(service.stop()).rejects.toMatchObject({ reason: 'operation_failed' })
    expect(service.canRetry(sessionId)).toBe(false)
    expect(audios[0].pause).toHaveBeenCalledTimes(1)
    expect(audios[0].src).toBe('')

    await service.stop()
    expect(audios[0].src).toBe('')
    expect(service.getSnapshot().phase).toBe('idle')
  })

  it('rejects teardown on discard failure and retains the run for a successful teardown retry', async () => {
    const { service, voice } = createHarness()
    voice.discardSession.mockRejectedValueOnce(new VoiceDomainError('operation_failed'))
    await service.start(baseInput)

    await expect(service.teardown()).rejects.toMatchObject({ reason: 'operation_failed' })
    expect(service.canRetry(sessionId)).toBe(false)

    await service.teardown()
    expect(voice.discardSession).toHaveBeenCalledTimes(2)
    expect(service.getSnapshot().phase).toBe('idle')
  })
})

describe('SpeechPlaybackService terminal ownership', () => {
  function pauseBeforeCompletion(voice: FakeVoiceService) {
    const completion = Promise.withResolvers<VoiceSessionState>()
    const reportPlayback = voice.reportPlayback.getMockImplementation()!
    voice.reportPlayback.mockImplementation(async (input) => {
      if (input.phase === 'completed') await voice.controlPlayback({ sessionId: input.sessionId, command: 'pause' })
      const state = await reportPlayback(input)
      if (input.phase === 'completed') completion.resolve(state)
      return state
    })
    return completion.promise
  }

  it('retains an exhausted run until an ignored completion is explicitly closed', async () => {
    const { service, voice, audios } = createHarness()
    const completion = pauseBeforeCompletion(voice)
    const cleanup = Promise.withResolvers<void>()
    const discardSession = voice.discardSession.getMockImplementation()!
    voice.discardSession.mockImplementationOnce(async (id) => {
      await cleanup.promise
      await discardSession(id)
    })
    await service.start(baseInput)
    audios[0].dispatchEvent(new Event('ended'))

    await expect(completion).resolves.toMatchObject({ sessionId, playback: { desired: 'paused' } })
    await vi.waitFor(() => expect(voice.discardSession).toHaveBeenCalledWith(sessionId))
    expect(service.getSnapshot().phase).not.toBe('idle')
    expect(voice.getSnapshot().phase).not.toBe('idle')
    expect(audios[0].src).toBe('')
    cleanup.resolve()
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('idle'))
    expect(voice.getSnapshot().phase).toBe('idle')

    await expect(service.start({ ...baseInput, trigger: 'auto_read' })).resolves.toEqual({ status: 'started' })
    expect(audios[1].paused).toBe(false)
    await service.stop()
    expect(voice.getSnapshot().phase).toBe('idle')
  })

  it('keeps failed terminal cleanup available for a later stop', async () => {
    const { service, voice, audios } = createHarness()
    const completion = pauseBeforeCompletion(voice)
    const cleanup = Promise.withResolvers<void>()
    voice.discardSession.mockReturnValueOnce(cleanup.promise)
    await service.start(baseInput)
    audios[0].dispatchEvent(new Event('ended'))

    await expect(completion).resolves.toMatchObject({ sessionId })
    await vi.waitFor(() => expect(voice.discardSession).toHaveBeenCalledWith(sessionId))
    const stopped = expect(service.stop()).rejects.toMatchObject({ reason: 'operation_failed' })
    cleanup.reject(new VoiceDomainError('operation_failed'))
    await stopped
    expect(service.getSnapshot().phase).not.toBe('idle')
    expect(voice.getSnapshot().phase).not.toBe('idle')
    expect(audios[0].src).toBe('')

    await service.stop()
    expect(service.getSnapshot().phase).toBe('idle')
    expect(voice.getSnapshot().phase).toBe('idle')
  })

  it('does not stop a newer run when an ignored completion arrives late', async () => {
    const { service, voice, audios } = createHarness()
    const completion = pauseBeforeCompletion(voice)
    const reply = Promise.withResolvers<void>()
    const reportPlayback = voice.reportPlayback.getMockImplementation()!
    voice.reportPlayback.mockImplementation(async (input) => {
      const state = await reportPlayback(input)
      if (input.sessionId === sessionId && input.phase === 'completed') await reply.promise
      return state
    })
    await service.start(baseInput)
    audios[0].dispatchEvent(new Event('ended'))
    await expect(completion).resolves.toMatchObject({ sessionId })

    const nextSessionId = '00000000-0000-4000-8000-000000000015'
    const generateSpeech = voice.generateSpeech.getMockImplementation()!
    voice.generateSpeech.mockImplementationOnce((input) => generateSpeech({ ...input, sessionId: nextSessionId }))
    await service.start({ ...baseInput, sourceLabel: 'selection' })
    reply.resolve()
    await vi.waitFor(() => expect(voice.discardSession).toHaveBeenCalledWith(sessionId))

    expect(service.getSnapshot()).toMatchObject({ phase: 'playing', sourceLabel: 'selection' })
    expect(voice.getSnapshot()).toMatchObject({ sessionId: nextSessionId, phase: 'playing' })
    expect(audios[1].paused).toBe(false)
    await service.pause()
    expect(audios[1].paused).toBe(true)
    await service.resume()
    await vi.waitFor(() => expect(audios[1].paused).toBe(false))
    await service.stop()
    expect(voice.getSnapshot().phase).toBe('idle')
  })
})

describe('SpeechPlaybackService ownership and lifecycle', () => {
  it.each(['pause', 'stop'] as const)('preserves a new %s while retry playback is pending', async (command) => {
    const { service, voice, audios, createAudio } = createHarness()
    await service.start(baseInput)
    audios[0].dispatchEvent(new Event('error'))
    await vi.waitFor(() => expect(voice.getSnapshot().phase).toBe('failed'))
    const retryAudio = new FakeAudio()
    let finish!: () => void
    retryAudio.play.mockImplementationOnce(() =>
      new Promise<void>((resolve) => {
        finish = resolve
      }).then(() => {
        retryAudio.paused = false
      })
    )
    createAudio.mockImplementationOnce((url) => {
      retryAudio.src = url
      audios.push(retryAudio)
      return retryAudio as unknown as HTMLAudioElement
    })
    await service.retry()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await service.control(sessionId, command)
    finish()
    await vi.waitFor(() => expect(retryAudio.paused).toBe(true))
    await vi.waitFor(() => expect(voice.getSnapshot().phase).toBe(command === 'pause' ? 'paused' : 'idle'))
    expect(service.getSnapshot().phase).toBe(command === 'pause' ? 'paused' : 'idle')
    expect(voice.generateSpeech).toHaveBeenCalledTimes(1)
  })

  it('does not let a failed attempt settle into or finish a successfully retried player', async () => {
    const oldAudio = new FakeAudio()
    let rejectOld!: (error: Error) => void
    oldAudio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectOld = reject
        })
    )
    const { service, voice, audios } = createHarness({ audio: oldAudio })
    const starting = service.start(baseInput).catch((error: unknown) => error)
    await vi.waitFor(() => expect(rejectOld).toBeTypeOf('function'))
    oldAudio.dispatchEvent(new Event('error'))
    await vi.waitFor(() => expect(voice.getSnapshot().phase).toBe('failed'))
    await service.retry()
    await vi.waitFor(() => expect(voice.getSnapshot().phase).toBe('playing'))
    rejectOld(new Error('old playback failure'))
    expect(await starting).toMatchObject({ reason: 'aborted' })
    oldAudio.dispatchEvent(new Event('error'))
    oldAudio.dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
    expect(voice.getSnapshot().phase).toBe('playing')
    expect(audios[1].paused).toBe(false)
    expect(voice.releaseOutput).not.toHaveBeenCalled()
  })

  it('resumes when a superseded pause aborts the previous pending play', async () => {
    const audio = new FakeAudio()
    let rejectPlay!: (error: DOMException) => void
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPlay = reject
        })
    )
    const { service, voice } = createHarness({ audio })
    const starting = service.start(baseInput)
    await vi.waitFor(() => expect(rejectPlay).toBeTypeOf('function'))
    await service.pause()
    await service.resume()
    rejectPlay(new DOMException('Interrupted by pause', 'AbortError'))
    await starting
    await vi.waitFor(() => expect(voice.getSnapshot().phase).toBe('playing'))
    expect(audio.paused).toBe(false)
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
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))

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
          output: { kind: 'audio', id: 'new-output', url: 'cherry-media://audio/output', mimeType: 'audio/wav' }
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
    const reportPlayback = voice.reportPlayback.getMockImplementation()!
    voice.reportPlayback.mockImplementation(async (input) => {
      if (input.sessionId === sessionId && input.phase === 'completed') throw new VoiceDomainError('operation_failed')
      return reportPlayback(input)
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
        output: { kind: 'audio', id: 'new-output', url: 'cherry-media://audio/output', mimeType: 'audio/wav' }
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
    expect(voice.reportPlayback).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'playing' }))
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
    expect(voice.reportPlayback).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'failed' }))
    expect(voice.reportPlayback).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'playing' }))
    expect(service.canRetry(sessionId)).toBe(false)

    voice.emitCommand('resume')
    await vi.waitFor(() => expect(service.getSnapshot().phase).toBe('playing'))
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(audio.paused).toBe(false)
    expect(voice.reportPlayback).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'failed' }))
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
    expect(voice.reportPlayback).toHaveBeenCalledWith(
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
    expect(voice.reportPlayback).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'failed', reason: 'operation_failed' })
    )

    await service.retry(sessionId)

    await vi.waitFor(() => expect(service.getSnapshot()).toMatchObject({ phase: 'playing' }))
    expect(voice.reportPlayback).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId, phase: 'playing' }))
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
    expect(voice.reportPlayback).toHaveBeenCalledWith(
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
