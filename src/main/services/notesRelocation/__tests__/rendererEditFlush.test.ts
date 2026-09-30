import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { application } from '@application'
import { WindowType } from '@main/core/window/types'

import { rendererEditFlushCoordinator } from '../rendererEditFlush'

const windowManager = application.get('WindowManager') as unknown as {
  getWindowsByType: ReturnType<typeof vi.fn>
  getWindowId: ReturnType<typeof vi.fn>
}
const ipcApiService = application.get('IpcApiService') as unknown as { send: ReturnType<typeof vi.fn> }

const mainWindow = { id: 'main' }
const subWindow = { id: 'sub-1' }

function mockWindows(main: Array<{ id: string }>, sub: Array<{ id: string }>) {
  windowManager.getWindowsByType.mockImplementation((type: WindowType) =>
    type === WindowType.Main ? main : type === WindowType.SubWindow ? sub : []
  )
  windowManager.getWindowId.mockImplementation((window: { id: string }) => window.id)
}

describe('RendererEditFlushCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately when no notes-capable window is open', async () => {
    mockWindows([], [])

    await expect(rendererEditFlushCoordinator.flush('caller')).resolves.toBe(true)
    expect(ipcApiService.send).not.toHaveBeenCalled()
  })

  it('asks every other main/sub window to flush and resolves once all acknowledge', async () => {
    mockWindows([mainWindow], [subWindow])

    const flushed = rendererEditFlushCoordinator.flush('main')

    // the caller window ('main') is excluded from the handshake
    expect(ipcApiService.send).toHaveBeenCalledTimes(1)
    expect(ipcApiService.send).toHaveBeenCalledWith('sub-1', 'app.notes_relocation.flush_requested', {
      batchId: expect.any(String)
    })

    const batchId = ipcApiService.send.mock.calls[0][2].batchId
    rendererEditFlushCoordinator.acknowledge(batchId, 'sub-1', true)

    await expect(flushed).resolves.toBe(true)
  })

  it('does not resolve before every targeted window acknowledges', async () => {
    mockWindows([], [subWindow])

    let resolved = false
    const flushed = rendererEditFlushCoordinator.flush(null).then((result) => {
      resolved = true
      return result
    })
    expect(ipcApiService.send).toHaveBeenCalledTimes(1)

    // an acknowledgement for a different batch must not complete this one
    rendererEditFlushCoordinator.acknowledge('other-batch', 'sub-1', true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resolved).toBe(false)

    const batchId = ipcApiService.send.mock.calls[0][2].batchId
    rendererEditFlushCoordinator.acknowledge(batchId, 'sub-1', true)

    await expect(flushed).resolves.toBe(true)
    expect(resolved).toBe(true)
  })

  it('resolves false when a window reports a failed flush', async () => {
    mockWindows([mainWindow], [])

    const flushed = rendererEditFlushCoordinator.flush(null)
    expect(ipcApiService.send).toHaveBeenCalledTimes(1)

    const batchId = ipcApiService.send.mock.calls[0][2].batchId
    rendererEditFlushCoordinator.acknowledge(batchId, 'main', false)

    await expect(flushed).resolves.toBe(false)
  })

  it('resolves after the timeout when a window never acknowledges', async () => {
    vi.useFakeTimers()
    mockWindows([], [subWindow])

    const flushed = rendererEditFlushCoordinator.flush('main')
    expect(ipcApiService.send).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)

    await expect(flushed).resolves.toBe(true)
  })

  it('ignores acknowledgements for unknown batches', () => {
    expect(() => rendererEditFlushCoordinator.acknowledge('unknown-batch', 'main', true)).not.toThrow()
  })
})
