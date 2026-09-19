import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { IpcRouter } from '@main/ipc/IpcRouter'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { voiceRequestSchemas } from '@shared/ipc/schemas/voice'

import { voiceHandlers } from '../voice'

const boundary = vi.hoisted(() => ({ abort: vi.fn(), speech: vi.fn(), transcribe: vi.fn(), window: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const module = mockApplicationFactory()
  module.application.get.mockImplementation((name: string) => {
    if (name === 'WindowManager') return { getWindow: boundary.window }
    if (name === 'VoiceSessionService')
      return { abort: boundary.abort, speech: boundary.speech, transcribe: boundary.transcribe }
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

describe('Voice handlers through real IpcRouter', () => {
  const router = new IpcRouter(voiceRequestSchemas, voiceHandlers)
  beforeEach(() => {
    boundary.abort.mockReset()
    boundary.speech.mockReset()
    boundary.transcribe.mockReset()
    boundary.window.mockReset()
  })

  it('dispatches every public speech and transcription operation with the managed owner', async () => {
    const webContents = { id: 10, isDestroyed: () => false }
    const owner = { windowId: 'owner', webContents }
    const transcription = {
      sessionId: input.sessionId,
      requestId: input.requestId,
      fileEntryId: '00000000-0000-4000-8000-000000000003',
      modelId: 'local-voice::apple-system-asr' as const,
      language: 'en-US'
    }
    const abort = { sessionId: input.sessionId, requestId: input.requestId }
    boundary.window.mockReturnValue({ webContents })

    await router.dispatch('ai.speech.generate', input, { senderId: 'owner' })
    await router.dispatch('ai.speech.abort', abort, { senderId: 'owner' })
    await router.dispatch('ai.transcription.generate', transcription, { senderId: 'owner' })
    await router.dispatch('ai.transcription.abort', abort, { senderId: 'owner' })

    expect(boundary.speech).toHaveBeenCalledWith(owner, input)
    expect(boundary.transcribe).toHaveBeenCalledWith(owner, transcription)
    expect(boundary.abort).toHaveBeenNthCalledWith(1, owner, abort)
    expect(boundary.abort).toHaveBeenNthCalledWith(2, owner, abort)
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
