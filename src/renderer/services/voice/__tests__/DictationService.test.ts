import { afterEach, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { DictationService } from '../DictationService'
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
    startRecording: vi.fn(() => {
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
    expect(harness.voice.transcribe).toHaveBeenCalledWith({ sessionId: 'session-1', fileEntryId: 'file-1' })
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
  })

  it('retains the same FileEntry after ASR failure and retries it with a new request', async () => {
    const harness = createHarness()
    harness.voice.transcribe.mockImplementationOnce(() =>
      operation('session-1', 'request-asr-1', Promise.reject({ reason: 'operation_failed' }))
    )
    harness.voice.retryTranscription.mockReturnValueOnce(
      operation(
        'session-1',
        'request-asr-2',
        Promise.resolve({ sessionId: 'session-1', requestId: 'request-asr-2', text: 'recovered text' })
      )
    )

    await startAndStop(harness.service)

    expect(harness.service.getSnapshot()).toMatchObject({
      phase: 'failed',
      recoveryAvailable: false,
      error: 'operation_failed'
    })
    expect(harness.voice.discardSession).not.toHaveBeenCalled()
    expect(harness.replaceRange).not.toHaveBeenCalled()

    await harness.service.retry()

    expect(harness.voice.retryTranscription).toHaveBeenCalledWith({
      sessionId: 'session-1',
      fileEntryId: 'file-1'
    })
    expect(harness.replaceRange).toHaveBeenCalledWith({ from: 2, to: 5 }, 'recovered text')
    expect(harness.voice.discardSession).toHaveBeenCalledWith('session-1')
    expect(harness.service.getSnapshot().phase).toBe('idle')
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
})
