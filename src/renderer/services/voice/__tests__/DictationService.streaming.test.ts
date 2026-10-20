import { afterEach, describe, expect, it, vi } from 'vitest'

import { QWEN3_ASR_MODEL_ID } from '@shared/ai/localVoice'
import type { TranscriptRevision } from '@shared/ai/voice'

import { DictationService } from '../DictationService'
import type { StreamingTranscription, VoiceCommandEvent } from '../VoiceService'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const services: DictationService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.teardown()))
})

function harness() {
  const result = deferred<{ text: string }>()
  const tail = deferred<number>()
  let revision!: (value: TranscriptRevision) => void
  let command!: (event: VoiceCommandEvent) => void
  const inserted: string[] = []
  const operation: StreamingTranscription = {
    sessionId: 'session',
    requestId: 'request',
    ready: Promise.resolve(),
    result: result.promise,
    write: async () => {},
    finish: vi.fn(async () => {})
  }
  const capture = {
    analyser: undefined,
    start: vi.fn(async () => {}),
    stop: () => tail.promise,
    cancel: vi.fn(async () => {})
  }
  const service = new DictationService({
    voice: {
      initialize: async () => {},
      readTranscriptionPreferenceInput: async () => ({ modelId: QWEN3_ASR_MODEL_ID }),
      resolveTranscriptionPreferences: async () => ({ modelId: QWEN3_ASR_MODEL_ID, streaming: true }),
      subscribeCommands: (listener) => {
        command = listener
        return () => {}
      },
      subscribeInterruptions: () => () => {},
      startRecording: () => ({ sessionId: 'session', requestId: 'admit', result: Promise.resolve() }),
      startStreamingTranscription: (_input, listener) => {
        revision = listener
        return operation
      },
      createRecording: async () => {
        throw new Error('Unexpected recorded-file path')
      },
      transcribe: () => {
        throw new Error('Unexpected complete transcription')
      },
      retryTranscription: () => {
        throw new Error('Unexpected retry')
      },
      abortTranscription: async () => {
        result.reject({ reason: 'aborted' })
      },
      discardSession: async () => {}
    },
    targets: {
      captureCurrent: () => null,
      insert: () => 'unavailable',
      insertIntoCurrent: (text) => {
        inserted.push(text)
        return 'inserted'
      }
    },
    createPcmCapture: () => capture,
    readMicrophoneDeviceId: async () => null
  })
  services.push(service)
  return {
    service,
    operation,
    result,
    tail,
    capture,
    inserted,
    revise: (value: TranscriptRevision) => revision(value),
    interrupt: () => command({ type: 'command', sessionId: 'session', revision: 1, command: 'interrupt' })
  }
}

describe('streaming dictation lifecycle', () => {
  it('replaces hypotheses but submits only the completed result after tail drain', async () => {
    const h = harness()
    await h.service.start()
    h.revise({ revision: 2, text: '你好世界', provisionalStart: 2, final: false })
    h.revise({ revision: 1, text: 'stale', provisionalStart: 0, final: false })
    expect(h.service.getSnapshot().transcript?.text).toBe('你好世界')
    h.revise({ revision: 3, text: '您好世界', provisionalStart: 4, final: true })
    expect(h.service.getSnapshot().phase).toBe('recording')
    expect(h.service.getSnapshot().recoveryAvailable).toBe(false)
    const stopping = h.service.stop()
    expect(h.operation.finish).not.toHaveBeenCalled()
    h.tail.resolve(1731)
    await vi.waitFor(() => expect(h.operation.finish).toHaveBeenCalledWith(1731))
    expect(h.service.getSnapshot().phase).toBe('transcribing')
    h.result.resolve({ text: '您好世界。' })
    await stopping
    expect(h.service.getSnapshot().phase).toBe('recovery')
    expect(h.service.insertRecovery()).toBe('inserted')
    expect(h.service.insertRecovery()).toBe('unavailable')
    expect(h.inserted).toEqual(['您好世界。'])
  })

  it('cancels on lock interruption and ignores late final text', async () => {
    const h = harness()
    await h.service.start()
    h.interrupt()
    await vi.waitFor(() => expect(h.service.getSnapshot().phase).toBe('idle'))
    h.revise({ revision: 10, text: 'late', provisionalStart: 4, final: true })
    expect(h.service.getSnapshot().transcript).toBeUndefined()
    expect(h.service.insertRecovery()).toBe('unavailable')
    expect(h.capture.cancel).toHaveBeenCalled()
  })

  it('releases capture after inference failure and offers no recorded-file retry', async () => {
    const h = harness()
    await h.service.start()
    h.result.reject({ reason: 'worker_crashed' })
    await vi.waitFor(() => expect(h.service.getSnapshot()).toMatchObject({ phase: 'failed', error: 'worker_crashed' }))
    expect(h.service.getSnapshot().retryAvailable).toBeUndefined()
    expect(h.capture.cancel).toHaveBeenCalled()
  })
})
