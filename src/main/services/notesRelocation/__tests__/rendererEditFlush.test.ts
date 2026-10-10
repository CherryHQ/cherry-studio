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

function migrationLockBatchId(): string {
  const call = ipcApiService.send.mock.calls.find((entry) => entry[1] === 'app.notes_relocation.migration_started')
  return call?.[2]?.batchId as string
}

function flushBatchId(): string {
  const call = ipcApiService.send.mock.calls.find((entry) => entry[1] === 'app.notes_relocation.flush_requested')
  return call?.[2]?.batchId as string
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

    await expect(rendererEditFlushCoordinator.prepareForMigration()).resolves.toBe(true)
    expect(ipcApiService.send).not.toHaveBeenCalled()
  })

  it('locks every window before asking other windows to flush', async () => {
    mockWindows([mainWindow], [subWindow])

    const prepared = rendererEditFlushCoordinator.prepareForMigration()

    expect(ipcApiService.send).toHaveBeenCalledWith('main', 'app.notes_relocation.migration_started', {
      batchId: expect.any(String)
    })
    expect(ipcApiService.send).toHaveBeenCalledWith('sub-1', 'app.notes_relocation.migration_started', {
      batchId: expect.any(String)
    })

    const lockBatchId = migrationLockBatchId()
    rendererEditFlushCoordinator.acknowledgeMigrationLock(lockBatchId, 'main', true)
    rendererEditFlushCoordinator.acknowledgeMigrationLock(lockBatchId, 'sub-1', true)

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(ipcApiService.send).toHaveBeenCalledWith('main', 'app.notes_relocation.flush_requested', {
      batchId: expect.any(String)
    })
    expect(ipcApiService.send).toHaveBeenCalledWith('sub-1', 'app.notes_relocation.flush_requested', {
      batchId: expect.any(String)
    })

    const flushId = flushBatchId()
    rendererEditFlushCoordinator.acknowledgeFlush(flushId, 'main', true)
    rendererEditFlushCoordinator.acknowledgeFlush(flushId, 'sub-1', true)

    await expect(prepared).resolves.toBe(true)
  })

  it('does not flush before every window acknowledges the migration lock', async () => {
    mockWindows([], [subWindow])

    let resolved = false
    const prepared = rendererEditFlushCoordinator.prepareForMigration().then((result) => {
      resolved = true
      return result
    })

    const lockBatchId = migrationLockBatchId()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resolved).toBe(false)
    expect(ipcApiService.send).not.toHaveBeenCalledWith(
      'sub-1',
      'app.notes_relocation.flush_requested',
      expect.anything()
    )

    rendererEditFlushCoordinator.acknowledgeMigrationLock(lockBatchId, 'sub-1', true)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const flushId = flushBatchId()
    rendererEditFlushCoordinator.acknowledgeFlush(flushId, 'sub-1', true)

    await expect(prepared).resolves.toBe(true)
    expect(resolved).toBe(true)
  })

  it('resolves false when a window reports a failed flush', async () => {
    mockWindows([mainWindow], [])

    const prepared = rendererEditFlushCoordinator.prepareForMigration()
    const lockBatchId = migrationLockBatchId()
    rendererEditFlushCoordinator.acknowledgeMigrationLock(lockBatchId, 'main', true)

    await new Promise((resolve) => setTimeout(resolve, 0))

    const flushId = flushBatchId()
    rendererEditFlushCoordinator.acknowledgeFlush(flushId, 'main', false)

    await expect(prepared).resolves.toBe(false)
  })

  it('resolves after the timeout when a window never acknowledges the lock', async () => {
    vi.useFakeTimers()
    mockWindows([], [subWindow])

    const prepared = rendererEditFlushCoordinator.prepareForMigration()

    await vi.advanceTimersByTimeAsync(5_000)

    await expect(prepared).resolves.toBe(false)
  })

  it('sends the migration lock to a window that opens while migration is in progress', async () => {
    mockWindows([mainWindow], [])

    const prepared = rendererEditFlushCoordinator.prepareForMigration()
    const lockBatchId = migrationLockBatchId()
    rendererEditFlushCoordinator.acknowledgeMigrationLock(lockBatchId, 'main', true)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const flushId = flushBatchId()
    ipcApiService.send.mockClear()
    rendererEditFlushCoordinator.syncMigrationLockToWindow('late-window')

    expect(ipcApiService.send).toHaveBeenCalledWith('late-window', 'app.notes_relocation.migration_started', {
      batchId: lockBatchId
    })

    rendererEditFlushCoordinator.acknowledgeFlush(flushId, 'main', true)
    await expect(prepared).resolves.toBe(true)
    rendererEditFlushCoordinator.clearMigrationLockBroadcast()
  })

  it('ignores acknowledgements for unknown batches', () => {
    expect(() => rendererEditFlushCoordinator.acknowledgeMigrationLock('unknown-batch', 'main', true)).not.toThrow()
    expect(() => rendererEditFlushCoordinator.acknowledgeFlush('unknown-batch', 'main', true)).not.toThrow()
  })
})
