import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { IpcRouter } from '@main/ipc/IpcRouter'
import { IpcError, IpcErrorCode } from '@shared/ipc/errors/IpcError'
import { voiceRequestSchemas } from '@shared/ipc/schemas/voice'

import { voiceHandlers } from '../voice'

const boundary = vi.hoisted(() => ({
  abort: vi.fn(),
  createRecording: vi.fn(),
  speech: vi.fn(),
  transcribe: vi.fn(),
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
        createRecording: boundary.createRecording,
        speech: boundary.speech,
        transcribe: boundary.transcribe
      }
    throw new Error('Unexpected service')
  })
  return module
})
const input = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  text: 'secret-text',
  voice: 'exact'
}
const transcription = {
  sessionId: input.sessionId,
  requestId: input.requestId,
  fileEntryId: '00000000-0000-4000-8000-000000000003',
  modelId: 'local-voice::apple-system-asr' as const,
  language: 'en-US'
}

async function expectValidationFailure(result: Promise<unknown>) {
  const error = await result.catch((error: unknown) => error)
  expect(error).toBeInstanceOf(IpcError)
  expect((error as IpcError).code).toBe(IpcErrorCode.VALIDATION_FAILED)
}

describe('Voice handlers through real IpcRouter', () => {
  const router = new IpcRouter(voiceRequestSchemas, voiceHandlers)
  beforeEach(() => {
    boundary.abort.mockReset()
    boundary.createRecording.mockReset()
    boundary.speech.mockReset()
    boundary.transcribe.mockReset()
    boundary.window.mockReset()
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
    ['a physical path', { path: '/tmp/voice' }]
  ])('rejects recording input containing %s before invoking the handler', async (_label, invalid) => {
    const recording = {
      sessionId: input.sessionId,
      audio: new Uint8Array([1, 2]),
      mimeType: 'audio/webm;codecs=opus',
      ...invalid
    }
    await expectValidationFailure(router.dispatch('file.voice_recording.create', recording, { senderId: 'owner' }))
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
