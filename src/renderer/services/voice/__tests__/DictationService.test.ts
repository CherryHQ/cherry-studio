import { afterEach, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { APPLE_ASR_MODEL_ID } from '@shared/ai/localVoice'

import { DictationService } from '../DictationService'
import type { VoiceCommandEvent } from '../VoiceService'
import { VoiceTargetManager } from '../VoiceTargetManager'

const WEBM_HEADER = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])

beforeAll(() => {
  if (typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(this)
      })
    }
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

class FakeMediaRecorder {
  state: RecordingState = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  readonly start = vi.fn(() => {
    this.state = 'recording'
  })
  readonly stop = vi.fn(() => {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    this.chunks.forEach((chunk) => this.ondataavailable?.({ data: chunk }))
    this.onstop?.()
  })

  constructor(private readonly chunks: Blob[]) {}
}

function operation<T>(sessionId: string, requestId: string, result: Promise<T>) {
  return { sessionId, requestId, result }
}

function createHarness(
  options: {
    chunks?: Blob[]
    getUserMedia?: Mock<(constraints: MediaStreamConstraints) => Promise<MediaStream>>
    now?: () => number
    targetManager?: VoiceTargetManager
  } = {}
) {
  let sessionNumber = 0
  let requestNumber = 0
  const events: string[] = []
  const commandListeners = new Set<(event: VoiceCommandEvent) => void>()
  const chunks = options.chunks ?? [new Blob([WEBM_HEADER]), new Blob([new Uint8Array([0x42, 0x82])])]
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
  const stream = { getTracks: () => tracks } as unknown as MediaStream
  const getUserMedia = options.getUserMedia ?? vi.fn(async () => stream)
  const recorders: FakeMediaRecorder[] = []
  const createMediaRecorder = vi.fn<(stream: MediaStream, recorderOptions: MediaRecorderOptions) => FakeMediaRecorder>(
    () => {
      const recorder = new FakeMediaRecorder(chunks)
      recorders.push(recorder)
      return recorder
    }
  )
  const voice = {
    initialize: vi.fn(async () => {
      events.push('initialize')
    }),
    subscribeCommands: vi.fn((listener: (event: VoiceCommandEvent) => void) => {
      events.push('subscribe')
      commandListeners.add(listener)
      return () => commandListeners.delete(listener)
    }),
    resolveTranscriptionPreferences: vi.fn(async () => ({
      modelId: 'local-voice::apple-system-asr' as const,
      language: 'zh-CN'
    })),
    startRecording: vi.fn(() => {
      events.push('start-recording')
      sessionNumber += 1
      requestNumber += 1
      return operation(
        `session-${sessionNumber}`,
        `request-${requestNumber}`,
        Promise.resolve({ revision: sessionNumber, phase: 'recording' as const, sessionId: `session-${sessionNumber}` })
      )
    }),
    createRecording: vi.fn<
      (input: { sessionId: string; audio: Uint8Array; durationMs: number }) => Promise<{
        readonly id: 'file-1'
        readonly origin: 'internal'
      }>
    >(async () => ({ id: 'file-1', origin: 'internal' })),
    transcribe: vi.fn((input: { sessionId: string }) => {
      requestNumber += 1
      return operation(
        input.sessionId,
        `request-${requestNumber}`,
        Promise.resolve({ sessionId: input.sessionId, requestId: `request-${requestNumber}`, text: 'hello world' })
      )
    }),
    retryTranscription: vi.fn((input: { sessionId: string }) => {
      requestNumber += 1
      return operation(
        input.sessionId,
        `request-${requestNumber}`,
        Promise.resolve({ sessionId: input.sessionId, requestId: `request-${requestNumber}`, text: 'retry text' })
      )
    }),
    abortTranscription: vi.fn(async () => undefined),
    discardSession: vi.fn<(sessionId: string) => Promise<void>>(async () => undefined)
  }
  const targetManager = options.targetManager ?? new VoiceTargetManager()
  const replaceRange = vi.fn(() => true)
  const owner = { closed: false } as Window
  const unbind = targetManager.bind({
    targetId: 'composer',
    owner,
    sourceEntityId: 'topic-a',
    captureReplaceRange: () => ({ from: 2, to: 5 }),
    replaceRange
  })
  targetManager.markCurrent('composer')
  const clipboard = { writeText: vi.fn(async () => undefined) }
  const service = new DictationService({
    voice,
    targets: targetManager,
    mediaDevices: { getUserMedia },
    createMediaRecorder,
    clipboard,
    now: options.now
  })

  return {
    clipboard,
    createMediaRecorder,
    emitCommand: (sessionId: string, command: VoiceCommandEvent['command'] = 'stop') => {
      commandListeners.forEach((listener) => listener({ type: 'command', revision: 1, sessionId, command }))
    },
    events,
    getUserMedia,
    owner,
    recorders,
    replaceRange,
    service,
    stream,
    targetManager,
    tracks,
    unbind,
    voice
  }
}

async function startAndStop(service: DictationService): Promise<void> {
  await service.start()
  await service.stop()
}

beforeEach(() => {
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DictationService recording lifecycle', () => {
  it('uses centrally resolved recognition preferences and the bound source entity', async () => {
    const harness = createHarness()

    await startAndStop(harness.service)

    expect(harness.voice.resolveTranscriptionPreferences).toHaveBeenCalledOnce()
    expect(harness.voice.startRecording).toHaveBeenCalledWith({ source: 'dictation', sourceEntityId: 'topic-a' })
    expect(harness.voice.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'local-voice::apple-system-asr',
        language: 'zh-CN'
      })
    )
  })

  it('waits for Main admission before requesting the microphone and uses the exact WebM recorder type', async () => {
    const admission = deferred<{ revision: number; phase: 'recording'; sessionId: string }>()
    const harness = createHarness()
    harness.voice.startRecording.mockReturnValueOnce(operation('session-a', 'request-a', admission.promise))

    const starting = harness.service.start()
    await Promise.resolve()
    expect(harness.getUserMedia).not.toHaveBeenCalled()

    admission.resolve({ revision: 1, phase: 'recording', sessionId: 'session-a' })
    await starting

    expect(harness.getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(harness.createMediaRecorder).toHaveBeenCalledWith(harness.stream, {
      mimeType: 'audio/webm;codecs=opus'
    })
    expect(harness.service.getSnapshot()).toEqual({
      phase: 'recording',
      elapsedMs: 0,
      recoveryAvailable: false
    })
  })

  it('registers the complete real Blob bytes and duration before transcribing and inserting the captured range', async () => {
    let now = 1_000
    const harness = createHarness({ now: () => now })
    await harness.service.start()
    const otherReplaceRange = vi.fn(() => true)
    harness.targetManager.bind({
      targetId: 'other-composer',
      owner: { closed: false } as Window,
      sourceEntityId: 'topic-b',
      captureReplaceRange: () => ({ from: 0, to: 0 }),
      replaceRange: otherReplaceRange
    })
    harness.targetManager.markCurrent('other-composer')
    now = 2_234

    await harness.service.stop()

    const recording = harness.voice.createRecording.mock.calls[0][0]
    expect(recording).toMatchObject({ sessionId: 'session-1', durationMs: 1_234 })
    expect(recording.audio).toEqual(new Uint8Array([...WEBM_HEADER, 0x42, 0x82]))
    expect(Array.from(recording.audio.slice(0, 4))).toEqual(Array.from(WEBM_HEADER))
    expect(harness.voice.transcribe).toHaveBeenCalledWith({
      sessionId: 'session-1',
      fileEntryId: 'file-1',
      modelId: APPLE_ASR_MODEL_ID,
      language: 'zh-CN'
    })
    expect(harness.replaceRange).toHaveBeenCalledWith({ from: 2, to: 5 }, 'hello world')
    expect(otherReplaceRange).not.toHaveBeenCalled()
    harness.tracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce())
    expect(harness.voice.discardSession).toHaveBeenCalledWith('session-1')
    expect(harness.service.getSnapshot()).toEqual({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
  })

  it('updates elapsed time and automatically stops and transcribes at 300000ms', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const harness = createHarness()
    await harness.service.start()

    await vi.advanceTimersByTimeAsync(2_000)
    expect(harness.service.getSnapshot()).toMatchObject({ phase: 'recording', elapsedMs: 2_000 })

    await vi.advanceTimersByTimeAsync(298_000)
    await vi.waitFor(() => expect(harness.voice.transcribe).toHaveBeenCalledOnce())

    expect(harness.voice.createRecording.mock.calls[0][0].durationMs).toBe(300_000)
    harness.tracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce())
  })

  it('stops every track and discards without transcribing when cancelled', async () => {
    const harness = createHarness()
    await harness.service.start()

    await harness.service.cancel()

    expect(harness.recorders[0].stop).toHaveBeenCalledOnce()
    harness.tracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce())
    expect(harness.voice.discardSession).toHaveBeenCalledWith('session-1')
    expect(harness.voice.createRecording).not.toHaveBeenCalled()
    expect(harness.voice.transcribe).not.toHaveBeenCalled()
    expect(harness.replaceRange).not.toHaveBeenCalled()
    expect(harness.service.getSnapshot()).toEqual({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
  })

  it('lets the scoped owner stop its recording and discard the admitted lease', async () => {
    const harness = createHarness()

    const run = harness.service.startScoped()
    await run.result
    await run.cancel()

    expect(harness.recorders[0].stop).toHaveBeenCalledOnce()
    harness.tracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce())
    expect(harness.voice.discardSession).toHaveBeenCalledWith('session-1')
    expect(harness.voice.createRecording).not.toHaveBeenCalled()
    expect(harness.service.getSnapshot()).toEqual({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
  })

  it('cancels a scoped run while initialize is pending without admitting a recording later', async () => {
    const initialization = deferred<void>()
    const harness = createHarness()
    harness.voice.initialize.mockReturnValueOnce(initialization.promise)

    const run = harness.service.startScoped()
    await vi.waitFor(() => expect(harness.voice.initialize).toHaveBeenCalledOnce())
    await run.cancel()
    initialization.resolve()
    await run.result

    expect(harness.voice.startRecording).not.toHaveBeenCalled()
    expect(harness.getUserMedia).not.toHaveBeenCalled()
    expect(harness.service.getSnapshot()).toEqual({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
  })

  it('cancels a pending scoped admission without requesting the microphone after it resolves', async () => {
    const admission = deferred<{ revision: number; phase: 'recording'; sessionId: string }>()
    const harness = createHarness()
    harness.voice.startRecording.mockReturnValueOnce(operation('session-a', 'request-a', admission.promise))

    const run = harness.service.startScoped()
    await vi.waitFor(() => expect(harness.voice.startRecording).toHaveBeenCalledOnce())
    await run.cancel()
    admission.resolve({ revision: 1, phase: 'recording', sessionId: 'session-a' })
    await run.result

    expect(harness.getUserMedia).not.toHaveBeenCalled()
    expect(harness.voice.discardSession).toHaveBeenCalledWith('session-a')
    expect(harness.service.getSnapshot()).toEqual({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
  })

  it('stops a late permission stream after its scoped owner cancels', async () => {
    const permission = deferred<MediaStream>()
    const lateTracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
    const lateStream = { getTracks: () => lateTracks } as unknown as MediaStream
    const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(() => permission.promise)
    const harness = createHarness({ getUserMedia })

    const run = harness.service.startScoped()
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }))
    await run.cancel()
    permission.resolve(lateStream)
    await run.result

    lateTracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce())
    expect(harness.createMediaRecorder).not.toHaveBeenCalled()
    expect(harness.voice.discardSession).toHaveBeenCalledWith('session-1')
    expect(harness.service.getSnapshot()).toEqual({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
  })

  it('does not let an older scoped owner cancel a replacement recording', async () => {
    const firstTrack = { stop: vi.fn() }
    const secondTrack = { stop: vi.fn() }
    const firstStream = { getTracks: () => [firstTrack] } as unknown as MediaStream
    const secondStream = { getTracks: () => [secondTrack] } as unknown as MediaStream
    const getUserMedia = vi
      .fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockResolvedValueOnce(firstStream)
      .mockResolvedValueOnce(secondStream)
    const harness = createHarness({ getUserMedia })

    const first = harness.service.startScoped()
    await first.result
    const second = harness.service.startScoped()
    await second.result
    await first.cancel()

    expect(firstTrack.stop).toHaveBeenCalledOnce()
    expect(secondTrack.stop).not.toHaveBeenCalled()
    expect(harness.voice.discardSession).not.toHaveBeenCalledWith('session-2')
    expect(harness.service.getSnapshot().phase).toBe('recording')

    await second.cancel()
    expect(secondTrack.stop).toHaveBeenCalledOnce()
    expect(harness.voice.discardSession).toHaveBeenCalledWith('session-2')
  })

  it('keeps replacement recording timers when an older permission request rejects late', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const firstPermission = deferred<MediaStream>()
    const replacementTrack = { stop: vi.fn() }
    const replacementStream = { getTracks: () => [replacementTrack] } as unknown as MediaStream
    const getUserMedia = vi
      .fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockReturnValueOnce(firstPermission.promise)
      .mockResolvedValueOnce(replacementStream)
    const harness = createHarness({ getUserMedia })

    const first = harness.service.startScoped()
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
    const replacement = harness.service.startScoped()
    await replacement.result
    expect(harness.service.getSnapshot().phase).toBe('recording')

    firstPermission.reject(new DOMException('late denial', 'NotAllowedError'))
    await first.result
    await vi.advanceTimersByTimeAsync(300_000)

    await vi.waitFor(() => expect(harness.voice.transcribe).toHaveBeenCalledOnce())
    expect(replacementTrack.stop).toHaveBeenCalledOnce()
  })

  it('cleans the previous session and tracks before a new recording, and cleans the replacement on teardown', async () => {
    const firstTrack = { stop: vi.fn() }
    const secondTrack = { stop: vi.fn() }
    const firstStream = { getTracks: () => [firstTrack] } as unknown as MediaStream
    const secondStream = { getTracks: () => [secondTrack] } as unknown as MediaStream
    const getUserMedia = vi
      .fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockResolvedValueOnce(firstStream)
      .mockResolvedValueOnce(secondStream)
    const harness = createHarness({ getUserMedia })
    await harness.service.start()

    await harness.service.start()

    expect(firstTrack.stop).toHaveBeenCalledOnce()
    expect(harness.voice.discardSession.mock.calls[0][0]).toBe('session-1')
    expect(harness.service.getSnapshot().phase).toBe('recording')

    await harness.service.teardown()
    expect(secondTrack.stop).toHaveBeenCalledOnce()
    expect(harness.voice.discardSession.mock.calls.at(-1)?.[0]).toBe('session-2')
  })

  it('subscribes before admission and stops a late permission stream after a matching Main stop', async () => {
    const permission = deferred<MediaStream>()
    const lateTracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
    const lateStream = { getTracks: () => lateTracks } as unknown as MediaStream
    const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(() => permission.promise)
    const harness = createHarness({ getUserMedia })

    await harness.service.initialize()
    await harness.service.initialize()
    expect(harness.voice.initialize).toHaveBeenCalledOnce()
    expect(harness.voice.subscribeCommands).toHaveBeenCalledOnce()
    const starting = harness.service.start()
    await vi.waitFor(() => expect(harness.getUserMedia).toHaveBeenCalledWith({ audio: true }))
    expect(harness.events.slice(0, 3)).toEqual(['subscribe', 'initialize', 'start-recording'])

    harness.emitCommand('another-session')
    expect(harness.voice.discardSession).not.toHaveBeenCalled()
    harness.emitCommand('session-1')
    await vi.waitFor(() => expect(harness.voice.discardSession).toHaveBeenCalledWith('session-1'))

    permission.resolve(lateStream)
    await starting

    lateTracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce())
    expect(harness.createMediaRecorder).not.toHaveBeenCalled()
    expect(harness.service.getSnapshot().phase).toBe('idle')
  })

  it('immediately stops the recorder, every track, and buffered chunks on a matching Main stop', async () => {
    const harness = createHarness()
    await harness.service.start()
    const active = (harness.service as unknown as { active?: { chunks: Blob[] } }).active

    harness.emitCommand('another-session')
    expect(harness.recorders[0].stop).not.toHaveBeenCalled()
    harness.emitCommand('session-1')

    expect(harness.recorders[0].stop).toHaveBeenCalledOnce()
    harness.tracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce())
    expect(active?.chunks).toEqual([])
    await vi.waitFor(() => expect(harness.voice.discardSession).toHaveBeenCalledWith('session-1'))
    await vi.waitFor(() => expect(harness.service.getSnapshot().phase).toBe('idle'))
  })
})

describe('DictationService failure and retry', () => {
  it('does not touch the target when microphone permission is denied', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('private permission detail', 'NotAllowedError'))
    const harness = createHarness({ getUserMedia })

    await harness.service.start()

    expect(harness.voice.discardSession).toHaveBeenCalledWith('session-1')
    expect(harness.replaceRange).not.toHaveBeenCalled()
    expect(harness.service.getSnapshot()).toEqual({
      phase: 'failed',
      elapsedMs: 0,
      recoveryAvailable: false,
      error: 'microphone_permission'
    })
    expect(JSON.stringify(harness.service.getSnapshot())).not.toContain('private permission detail')
    expect(harness.service.getSnapshot()).not.toHaveProperty('retryAvailable')
  })

  it('retains the same FileEntry after ASR failure and retries it with a new request', async () => {
    const transcription = deferred<{ sessionId: string; requestId: string; text: string }>()
    const retry = deferred<{ sessionId: string; requestId: string; text: string }>()
    const audioCanary = new Blob([WEBM_HEADER, 'PRIVATE_AUDIO_CANARY'])
    const harness = createHarness({ chunks: [audioCanary] })
    harness.voice.transcribe.mockReturnValueOnce(operation('session-1', 'request-asr-1', transcription.promise))
    harness.voice.retryTranscription.mockReturnValueOnce(operation('session-1', 'request-asr-2', retry.promise))

    await harness.service.start()
    const stopping = harness.service.stop()
    await vi.waitFor(() => expect(harness.voice.transcribe).toHaveBeenCalledOnce())
    expect((harness.service as unknown as { active?: { chunks: Blob[] } }).active?.chunks).toEqual([])
    transcription.reject({ reason: 'operation_failed' })
    await stopping

    expect(harness.service.getSnapshot()).toMatchObject({
      phase: 'failed',
      recoveryAvailable: false,
      retryAvailable: true,
      error: 'operation_failed'
    })
    expect(harness.voice.discardSession).not.toHaveBeenCalled()
    expect(harness.replaceRange).not.toHaveBeenCalled()

    const retrying = harness.service.retry()
    await vi.waitFor(() => expect(harness.voice.retryTranscription).toHaveBeenCalledOnce())
    expect((harness.service as unknown as { active?: { chunks: Blob[] } }).active?.chunks).toEqual([])
    retry.resolve({ sessionId: 'session-1', requestId: 'request-asr-2', text: 'recovered text' })
    await retrying

    expect(harness.voice.retryTranscription).toHaveBeenCalledWith({
      sessionId: 'session-1',
      fileEntryId: 'file-1',
      modelId: APPLE_ASR_MODEL_ID,
      language: 'zh-CN'
    })
    expect(harness.replaceRange).toHaveBeenCalledWith({ from: 2, to: 5 }, 'recovered text')
    expect(harness.voice.discardSession).toHaveBeenCalledWith('session-1')
    expect(harness.service.getSnapshot()).toEqual({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
  })

  it('aborts transcription and prevents late injection when its scoped owner cancels', async () => {
    const transcription = deferred<{ sessionId: string; requestId: string; text: string }>()
    const harness = createHarness()
    harness.voice.transcribe.mockReturnValueOnce(operation('session-1', 'request-asr', transcription.promise))

    const run = harness.service.startScoped()
    await run.result
    const stopping = harness.service.stop()
    await vi.waitFor(() => expect(harness.voice.transcribe).toHaveBeenCalledOnce())
    await run.cancel()
    transcription.resolve({ sessionId: 'session-1', requestId: 'request-asr', text: 'late private transcript' })
    await stopping

    expect(harness.voice.abortTranscription).toHaveBeenCalledWith({
      sessionId: 'session-1',
      requestId: 'request-asr',
      result: transcription.promise
    })
    expect(harness.voice.discardSession).toHaveBeenCalledWith('session-1')
    expect(harness.replaceRange).not.toHaveBeenCalled()
    expect(harness.service.getSnapshot()).toEqual({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
  })

  it('preserves cleanup failure over microphone permission failure', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    const harness = createHarness({ getUserMedia })
    harness.voice.discardSession.mockRejectedValueOnce({ reason: 'operation_failed' })

    await harness.service.start()

    expect(harness.service.getSnapshot()).toEqual({
      phase: 'failed',
      elapsedMs: 0,
      recoveryAvailable: false,
      error: 'operation_failed'
    })
  })

  it('preserves cleanup failure over recorder setup failure', async () => {
    const harness = createHarness()
    harness.createMediaRecorder.mockImplementationOnce(() => {
      throw new Error('recorder setup failed')
    })
    harness.voice.discardSession.mockRejectedValueOnce({ reason: 'operation_failed' })

    await harness.service.start()

    harness.tracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce())
    expect(harness.service.getSnapshot()).toEqual({
      phase: 'failed',
      elapsedMs: 0,
      recoveryAvailable: false,
      error: 'operation_failed'
    })
  })
})

describe('DictationService private recovery', () => {
  it('keeps an unavailable completion only in memory and inserts it into an explicitly current recovery target', async () => {
    const transcription = deferred<{ sessionId: string; requestId: string; text: string }>()
    const harness = createHarness()
    harness.voice.transcribe.mockReturnValueOnce(operation('session-1', 'request-asr', transcription.promise))
    await harness.service.start()
    const stopping = harness.service.stop()
    await vi.waitFor(() => expect(harness.voice.transcribe).toHaveBeenCalledOnce())
    harness.unbind()
    transcription.resolve({ sessionId: 'session-1', requestId: 'request-asr', text: 'private transcript' })
    await stopping

    const snapshot = harness.service.getSnapshot()
    expect(snapshot).toEqual({ phase: 'recovery', elapsedMs: 0, recoveryAvailable: true })
    expect(JSON.stringify(snapshot)).not.toMatch(/private transcript|audio|path|blob/i)
    expect(harness.voice.discardSession).toHaveBeenCalledWith('session-1')

    const recoveryInsert = vi.fn(() => true)
    harness.targetManager.bind({
      targetId: 'recovery-composer',
      owner: { closed: false } as Window,
      sourceEntityId: 'topic-b',
      captureReplaceRange: () => ({ from: 9, to: 9 }),
      replaceRange: recoveryInsert
    })
    harness.targetManager.markCurrent('recovery-composer')

    expect(harness.service.insertRecovery()).toBe('inserted')
    expect(recoveryInsert).toHaveBeenCalledWith({ from: 9, to: 9 }, 'private transcript')
    expect(harness.service.getSnapshot()).toEqual({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
    expect(harness.service.insertRecovery()).toBe('unavailable')
  })

  it('supports one-shot clipboard copy and explicit recovery discard', async () => {
    const first = createHarness()
    first.unbind()
    await startAndStop(first.service)

    await expect(first.service.copyRecovery()).resolves.toBe(true)
    expect(first.clipboard.writeText).toHaveBeenCalledWith('hello world')
    expect(first.service.getSnapshot().recoveryAvailable).toBe(false)
    await expect(first.service.copyRecovery()).resolves.toBe(false)

    const second = createHarness()
    second.unbind()
    await startAndStop(second.service)
    expect(second.service.getSnapshot().recoveryAvailable).toBe(true)

    await second.service.discard()
    expect(second.service.getSnapshot()).toEqual({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
    expect(second.service.insertRecovery()).toBe('unavailable')
  })

  it('lets the scoped owner discard recovery without affecting a completed successful run', async () => {
    const recovered = createHarness()
    recovered.unbind()
    const recoveryRun = recovered.service.startScoped()
    await recoveryRun.result
    await recovered.service.stop()

    expect(recovered.service.getSnapshot()).toEqual({ phase: 'recovery', elapsedMs: 0, recoveryAvailable: true })
    await recoveryRun.cancel()
    expect(recovered.service.getSnapshot()).toEqual({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
    expect(recovered.service.insertRecovery()).toBe('unavailable')
    expect(recovered.voice.discardSession).toHaveBeenCalledOnce()

    const completed = createHarness()
    const completedRun = completed.service.startScoped()
    await completedRun.result
    await completed.service.stop()
    expect(completed.service.getSnapshot()).toEqual({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })

    await completedRun.cancel()
    expect(completed.voice.discardSession).toHaveBeenCalledOnce()
    expect(completed.service.getSnapshot()).toEqual({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
  })

  it('retires scoped ownership after recovery is explicitly inserted', async () => {
    const harness = createHarness()
    harness.unbind()
    const run = harness.service.startScoped()
    await run.result
    await harness.service.stop()

    harness.targetManager.bind({
      targetId: 'recovery-composer',
      owner: { closed: false } as Window,
      sourceEntityId: 'topic-b',
      captureReplaceRange: () => ({ from: 0, to: 0 }),
      replaceRange: vi.fn(() => true)
    })
    harness.targetManager.markCurrent('recovery-composer')
    const onChange = vi.fn()
    harness.service.subscribe(onChange)

    expect(harness.service.insertRecovery()).toBe('inserted')
    expect(onChange).toHaveBeenCalledOnce()
    await run.cancel()

    expect(onChange).toHaveBeenCalledOnce()
    expect(harness.voice.discardSession).toHaveBeenCalledOnce()
    expect(harness.service.getSnapshot()).toEqual({ phase: 'idle', elapsedMs: 0, recoveryAvailable: false })
  })

  it('does not let an older clipboard success consume an identical replacement recovery', async () => {
    const clipboardWrite = deferred<undefined>()
    const harness = createHarness()
    harness.unbind()
    const first = harness.service.startScoped()
    await first.result
    await harness.service.stop()
    harness.clipboard.writeText.mockReturnValueOnce(clipboardWrite.promise)
    const copying = harness.service.copyRecovery()

    const replacement = harness.service.startScoped()
    await replacement.result
    await harness.service.stop()
    expect(harness.service.getSnapshot()).toEqual({ phase: 'recovery', elapsedMs: 0, recoveryAvailable: true })

    clipboardWrite.resolve(undefined)
    await expect(copying).resolves.toBe(true)

    expect(harness.service.getSnapshot()).toEqual({ phase: 'recovery', elapsedMs: 0, recoveryAvailable: true })
    await replacement.cancel()
  })

  it('does not let an older clipboard failure replace a newer recording snapshot', async () => {
    const clipboardWrite = deferred<undefined>()
    const harness = createHarness()
    harness.unbind()
    const first = harness.service.startScoped()
    await first.result
    await harness.service.stop()
    harness.clipboard.writeText.mockReturnValueOnce(clipboardWrite.promise)
    const copying = harness.service.copyRecovery()

    const replacement = harness.service.startScoped()
    await replacement.result
    clipboardWrite.reject(new Error('late clipboard failure'))
    await expect(copying).resolves.toBe(false)

    expect(harness.service.getSnapshot()).toEqual({ phase: 'recording', elapsedMs: 0, recoveryAvailable: false })
    await replacement.cancel()
  })

  it('keeps successful ASR as recovery when captured insertion and post-ASR cleanup fail', async () => {
    const cleanup = deferred<void>()
    const harness = createHarness()
    harness.replaceRange.mockImplementationOnce(() => {
      throw new Error('target unmounted during insertion')
    })
    harness.voice.discardSession.mockReturnValueOnce(cleanup.promise)

    await harness.service.start()
    const stopping = harness.service.stop()
    await vi.waitFor(() => expect(harness.voice.discardSession).toHaveBeenCalledWith('session-1'))

    const active = (harness.service as unknown as { active?: { fileEntryId?: string } }).active
    expect(active?.fileEntryId).toBeUndefined()
    cleanup.reject({ reason: 'operation_failed' })
    await stopping
    expect(harness.service.getSnapshot()).toEqual({
      phase: 'recovery',
      elapsedMs: 0,
      recoveryAvailable: true,
      error: 'operation_failed'
    })

    await harness.service.retry()
    expect(harness.voice.retryTranscription).not.toHaveBeenCalled()
    await expect(harness.service.copyRecovery()).resolves.toBe(true)
    expect(harness.clipboard.writeText).toHaveBeenCalledWith('hello world')
  })
})
