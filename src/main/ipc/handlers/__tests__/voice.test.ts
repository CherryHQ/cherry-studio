import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { IpcRouter } from '@main/ipc/IpcRouter'
import type { InternalFileEntry } from '@shared/data/types/file'
import { IpcError, IpcErrorCode } from '@shared/ipc/errors/IpcError'
import { voiceRequestSchemas } from '@shared/ipc/schemas/voice'

import { voiceHandlers } from '../voice'

const boundary = vi.hoisted(() => ({
  abort: vi.fn(),
  controlPlayback: vi.fn(),
  createRecording: vi.fn(),
  getMicrophoneStatus: vi.fn(),
  listTranscriptionLocales: vi.fn(),
  getState: vi.fn(),
  openMicrophoneSettings: vi.fn(),
  readOutput: vi.fn(),
  releaseOutput: vi.fn(),
  speech: vi.fn(),
  startRecording: vi.fn(),
  transcribe: vi.fn(),
  updatePlayback: vi.fn(),
  window: vi.fn()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const module = mockApplicationFactory()
  module.application.get.mockImplementation((name: string) => {
    if (name === 'WindowManager') return { getWindow: boundary.window }
    if (name === 'VoiceSessionService')
      return {
        abort: boundary.abort,
        controlPlayback: boundary.controlPlayback,
        createRecording: boundary.createRecording,
        getMicrophoneStatus: boundary.getMicrophoneStatus,
        listTranscriptionLocales: boundary.listTranscriptionLocales,
        getState: boundary.getState,
        openMicrophoneSettings: boundary.openMicrophoneSettings,
        readOutput: boundary.readOutput,
        releaseOutput: boundary.releaseOutput,
        speech: boundary.speech,
        startRecording: boundary.startRecording,
        transcribe: boundary.transcribe,
        updatePlayback: boundary.updatePlayback
      }
    throw new Error('Unexpected service')
  })
  return module
})
const input = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  text: 'secret-text',
  voice: 'exact',
  sourceEntityId: 'message-1'
}
const transcription = {
  sessionId: input.sessionId,
  requestId: input.requestId,
  fileEntryId: '00000000-0000-4000-8000-000000000003',
  modelId: 'local-voice::apple-system-asr' as const,
  language: 'en-US'
}
const recording = {
  sessionId: input.sessionId,
  audio: new Uint8Array([1, 2]),
  mimeType: 'audio/webm;codecs=opus',
  durationMs: 1_000
}

async function expectValidationFailure(result: Promise<unknown>) {
  const error = await result.catch((error: unknown) => error)
  expect(error).toBeInstanceOf(IpcError)
  expect((error as IpcError).code).toBe(IpcErrorCode.VALIDATION_FAILED)
}

describe('Voice handlers through real IpcRouter', () => {
  const router = new IpcRouter(voiceRequestSchemas, voiceHandlers)
  beforeEach(() => {
    for (const mock of Object.values(boundary)) mock.mockReset()
  })

  it('lists Apple transcription locales for a managed window', async () => {
    const webContents = { id: 10, isDestroyed: () => false }
    const owner = { windowId: 'owner', webContents }
    boundary.window.mockReturnValue({ webContents })
    boundary.listTranscriptionLocales.mockResolvedValue({ supported: ['en-US', 'zh-CN'], installed: ['en-US'] })

    await expect(router.dispatch('ai.transcription.locales.list', undefined, { senderId: 'owner' })).resolves.toEqual({
      supported: ['en-US', 'zh-CN'],
      installed: ['en-US']
    })
    expect(boundary.listTranscriptionLocales).toHaveBeenCalledWith(owner)
  })

  it('rebuilds the managed owner for every Voice coordination route', async () => {
    const webContents = { id: 10, isDestroyed: () => false }
    const owner = { windowId: 'owner', webContents }
    const fileEntryId = '00000000-0000-4000-8000-000000000004'
    boundary.window.mockReturnValue({ webContents })
    boundary.getState.mockReturnValue({ phase: 'idle', revision: 0 })
    boundary.startRecording.mockReturnValue({ phase: 'recording', revision: 1, sessionId: input.sessionId })
    boundary.readOutput.mockResolvedValue({ audio: new Uint8Array([1]), mimeType: 'audio/wav' })
    boundary.getMicrophoneStatus.mockReturnValue('unknown')

    await router.dispatch('ai.voice.session.state', undefined, { senderId: 'owner' })
    await router.dispatch(
      'ai.voice.recording.start',
      {
        sessionId: input.sessionId,
        requestId: input.requestId,
        source: 'dictation',
        sourceEntityId: 'topic-1'
      },
      { senderId: 'owner' }
    )
    await router.dispatch('ai.voice.output.read', { sessionId: input.sessionId, fileEntryId }, { senderId: 'owner' })
    await router.dispatch('ai.voice.output.release', { sessionId: input.sessionId, fileEntryId }, { senderId: 'owner' })
    await router.dispatch(
      'ai.voice.playback.update',
      { sessionId: input.sessionId, phase: 'playing' },
      { senderId: 'owner' }
    )
    await router.dispatch(
      'ai.voice.playback.control',
      { sessionId: input.sessionId, command: 'pause' },
      { senderId: 'owner' }
    )
    await router.dispatch('ai.voice.microphone.status', undefined, { senderId: 'owner' })
    await router.dispatch('ai.voice.microphone.open_settings', undefined, { senderId: 'owner' })

    for (const method of [
      boundary.getState,
      boundary.startRecording,
      boundary.readOutput,
      boundary.releaseOutput,
      boundary.updatePlayback,
      boundary.controlPlayback,
      boundary.getMicrophoneStatus,
      boundary.openMicrophoneSettings
    ]) {
      expect(method.mock.calls[0]?.[0]).toEqual(owner)
    }
    expect(boundary.startRecording).toHaveBeenCalledWith(owner, {
      sessionId: input.sessionId,
      requestId: input.requestId,
      source: 'dictation',
      sourceEntityId: 'topic-1'
    })
  })

  it('rejects forged Voice coordination fields before the service boundary', async () => {
    boundary.window.mockReturnValue({ webContents: { id: 10, isDestroyed: () => false } })
    for (const [route, value] of [
      ['ai.voice.recording.start', { sessionId: input.sessionId, requestId: input.requestId, ownerWindowId: 'other' }],
      ['ai.voice.output.read', { sessionId: input.sessionId, fileEntryId: transcription.fileEntryId, path: '/tmp/x' }],
      ['ai.voice.playback.control', { sessionId: input.sessionId, command: 'stop', adapter: 'apple' }],
      ['ai.voice.microphone.open_settings', { url: 'https://evil.test' }]
    ] as const) {
      await expectValidationFailure(router.dispatch(route, value, { senderId: 'owner' }))
    }
    expect(boundary.startRecording).not.toHaveBeenCalled()
    expect(boundary.readOutput).not.toHaveBeenCalled()
    expect(boundary.controlPlayback).not.toHaveBeenCalled()
    expect(boundary.openMicrophoneSettings).not.toHaveBeenCalled()
  })

  it('dispatches a FileEntry transcription with the managed owner', async () => {
    const webContents = { id: 10, isDestroyed: () => false }
    const owner = { windowId: 'owner', webContents }
    boundary.window.mockReturnValue({ webContents })

    await router.dispatch('ai.transcription.generate', transcription, { senderId: 'owner' })

    expect(boundary.transcribe).toHaveBeenCalledWith(owner, transcription)
  })

  it('dispatches speech and abort operations with the managed owner', async () => {
    const webContents = { id: 10, isDestroyed: () => false }
    const owner = { windowId: 'owner', webContents }
    const abort = { sessionId: input.sessionId, requestId: input.requestId }
    boundary.window.mockReturnValue({ webContents })

    await router.dispatch('ai.speech.generate', input, { senderId: 'owner' })
    await router.dispatch('ai.speech.abort', abort, { senderId: 'owner' })
    await router.dispatch('ai.transcription.abort', abort, { senderId: 'owner' })

    expect(boundary.speech).toHaveBeenCalledWith(owner, input)
    expect(boundary.abort).toHaveBeenNthCalledWith(1, owner, abort, 'speech')
    expect(boundary.abort).toHaveBeenNthCalledWith(2, owner, abort, 'transcription')
  })

  it('dispatches a valid WebM/Opus recording with the managed owner and returns its FileEntry', async () => {
    const webContents = { id: 10, isDestroyed: () => false }
    const owner = { windowId: 'owner', webContents }
    const entry: InternalFileEntry = {
      id: '00000000-0000-4000-8000-000000000004',
      name: 'voice-recording',
      ext: 'webm',
      origin: 'internal',
      size: recording.audio.byteLength,
      contentHash: null,
      cleanupPolicy: 'delete_when_unreferenced',
      createdAt: 1,
      updatedAt: 1
    }
    boundary.window.mockReturnValue({ webContents })
    boundary.createRecording.mockResolvedValue(entry)

    await expect(router.dispatch('file.voice_recording.create', recording, { senderId: 'owner' })).resolves.toBe(entry)
    expect(boundary.createRecording).toHaveBeenCalledWith(owner, recording)
  })

  it.each([
    ['a physical path', { path: '/private/audio.webm' }],
    ['audio bytes', { audio: new Uint8Array([1]) }],
    ['a bytes array', { bytes: [1] }],
    ['base64 audio', { base64: 'YQ==' }],
    ['an adapter', { adapter: 'apple' }],
    ['provider options', { providerOptions: {} }],
    ['an owner window id', { ownerWindowId: 'other' }],
    ['no FileEntry id', { fileEntryId: undefined }],
    ['a remote model id', { modelId: 'openai::whisper-1' }]
  ])('rejects transcription input containing %s before invoking the handler', async (_label, invalid) => {
    await expectValidationFailure(
      router.dispatch('ai.transcription.generate', { ...transcription, ...invalid }, { senderId: 'owner' })
    )
    expect(boundary.transcribe).not.toHaveBeenCalled()
  })

  it.each([
    ['the wrong MIME type', { mimeType: 'audio/wav' }],
    ['a physical path', { path: '/tmp/voice' }],
    ['a negative duration', { durationMs: -1 }],
    ['an excessive duration', { durationMs: 300_001 }]
  ])('rejects recording input containing %s before invoking the handler', async (_label, invalid) => {
    await expectValidationFailure(
      router.dispatch('file.voice_recording.create', { ...recording, ...invalid }, { senderId: 'owner' })
    )
    expect(boundary.createRecording).not.toHaveBeenCalled()
  })

  it('requires an exact voice before invoking speech', async () => {
    const withoutVoice = {
      sessionId: input.sessionId,
      requestId: input.requestId,
      text: 'hello',
      modelId: 'local-voice::apple-system-tts'
    }
    await expectValidationFailure(router.dispatch('ai.speech.generate', withoutVoice, { senderId: 'owner' }))
    expect(boundary.speech).not.toHaveBeenCalled()
  })

  it.each([0.49, 2.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1'])(
    'returns the stable validation failure for unsupported speech speed %s',
    async (speed) => {
      await expectValidationFailure(router.dispatch('ai.speech.generate', { ...input, speed }, { senderId: 'owner' }))
      expect(boundary.speech).not.toHaveBeenCalled()
    }
  )

  it('refuses unmanaged/destroyed owners before invoking the operation', async () => {
    await expect(router.dispatch('ai.speech.generate', input, { senderId: null })).rejects.toMatchObject({
      code: 'VOICE_FORBIDDEN'
    })
    boundary.window.mockReturnValue({ webContents: { isDestroyed: () => true } })
    await expect(router.dispatch('ai.speech.generate', input, { senderId: 'owner' })).rejects.toMatchObject({
      code: 'VOICE_FORBIDDEN'
    })
    expect(boundary.speech).not.toHaveBeenCalled()
  })
  it('derives ownership from the managed window and strips arbitrary native errors', async () => {
    const webContents = { id: 10, isDestroyed: () => false }
    boundary.window.mockReturnValue({ webContents })
    boundary.speech.mockRejectedValue(new Error('secret-transcript /Users/private/file.wav secret-text'))
    const error = await router.dispatch('ai.speech.generate', input, { senderId: 'owner' }).catch((error) => error)
    expect(error).toBeInstanceOf(IpcError)
    expect((error as IpcError).toJSON()).toEqual({
      code: 'VOICE_OPERATION_FAILED',
      message: 'operation_failed',
      data: { reason: 'operation_failed' }
    })
    expect(boundary.speech.mock.calls[0][0]).toEqual({ windowId: 'owner', webContents })
    expect(application.get).toHaveBeenCalledWith('VoiceSessionService')
  })
})
