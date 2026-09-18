import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { IpcRouter } from '@main/ipc/IpcRouter'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { voiceRequestSchemas } from '@shared/ipc/schemas/voice'

import { voiceHandlers } from '../voice'

const boundary = vi.hoisted(() => ({ speech: vi.fn(), window: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const module = mockApplicationFactory()
  module.application.get.mockImplementation((name: string) => {
    if (name === 'WindowManager') return { getWindow: boundary.window }
    if (name === 'VoiceSessionService') return { speech: boundary.speech }
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
    boundary.speech.mockReset()
    boundary.window.mockReset()
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
