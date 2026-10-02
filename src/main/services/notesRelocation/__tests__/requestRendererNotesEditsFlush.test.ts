import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WindowType } from '@main/core/window/types'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'

const { broadcastMock, getAllWindowsMock, getWindowIdMock, getWindowTypeMock } = vi.hoisted(() => ({
  broadcastMock: vi.fn(),
  getAllWindowsMock: vi.fn((): Electron.BrowserWindow[] => []),
  getWindowIdMock: vi.fn((): string | undefined => undefined),
  getWindowTypeMock: vi.fn((): WindowType | undefined => undefined)
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    IpcApiService: { broadcast: broadcastMock },
    WindowManager: {
      getWindowId: getWindowIdMock,
      getWindowType: getWindowTypeMock
    }
  })
})

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => getAllWindowsMock()
  }
}))

import {
  acknowledgeRendererNotesEditsFlush,
  registerRendererNotesEditsFlushWindow,
  requestRendererNotesEditsFlush,
  unregisterRendererNotesEditsFlushWindow
} from '../requestRendererNotesEditsFlush'

describe('requestRendererNotesEditsFlush', () => {
  beforeEach(() => {
    getAllWindowsMock.mockReturnValue([{ isDestroyed: () => false }] as unknown as Electron.BrowserWindow[])
    getWindowIdMock.mockReturnValue('window-a')
    getWindowTypeMock.mockReturnValue(WindowType.Main)
  })

  afterEach(async () => {
    broadcastMock.mockClear()
    getAllWindowsMock.mockReset()
    getWindowIdMock.mockReset()
    getWindowTypeMock.mockReset()
    unregisterRendererNotesEditsFlushWindow('window-a')
    unregisterRendererNotesEditsFlushWindow('window-b')
    await Promise.resolve()
  })

  it('resolves when a registered window acknowledges success', async () => {
    registerRendererNotesEditsFlushWindow('window-a')

    const flushPromise = requestRendererNotesEditsFlush()
    const requestId = broadcastMock.mock.calls[0]?.[1]?.requestId as string

    acknowledgeRendererNotesEditsFlush(requestId, 'window-a', true)

    await expect(flushPromise).resolves.toBeUndefined()
  })

  it('rejects when a window acknowledges a failed flush', async () => {
    registerRendererNotesEditsFlushWindow('window-a')

    const flushPromise = requestRendererNotesEditsFlush()
    const requestId = broadcastMock.mock.calls[0]?.[1]?.requestId as string

    acknowledgeRendererNotesEditsFlush(requestId, 'window-a', false)

    await expect(flushPromise).rejects.toMatchObject({
      code: notesRelocationErrorCodes.NOTES_RELOCATION_FLUSH_FAILED
    })
    await expect(flushPromise).rejects.toBeInstanceOf(IpcError)
  })

  it('rejects when an open notes window lacks a flush listener', async () => {
    await expect(requestRendererNotesEditsFlush()).rejects.toMatchObject({
      code: notesRelocationErrorCodes.NOTES_RELOCATION_FLUSH_FAILED
    })
    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it('rejects when a registered window unregisters before acknowledging', async () => {
    registerRendererNotesEditsFlushWindow('window-a')

    const flushPromise = requestRendererNotesEditsFlush()
    unregisterRendererNotesEditsFlushWindow('window-a')

    await expect(flushPromise).rejects.toMatchObject({
      code: notesRelocationErrorCodes.NOTES_RELOCATION_FLUSH_FAILED
    })
    await expect(flushPromise).rejects.toBeInstanceOf(IpcError)
  })
})
