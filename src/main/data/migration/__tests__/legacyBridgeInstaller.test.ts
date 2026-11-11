import { EventEmitter } from 'node:events'

import type { CancellationToken } from 'builder-util-runtime'
import type { AppUpdater } from 'electron-updater'
import { describe, expect, it, vi } from 'vitest'

import { LegacyBridgeInstaller } from '../legacyBridgeInstaller'

function fixture(prepareProfile?: () => () => void) {
  let finishDownload!: () => void
  let token: CancellationToken | undefined
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: { version: '2.1.0' } })),
    downloadUpdate: vi.fn((next: CancellationToken) => {
      token = next
      return new Promise<void>((resolve) => {
        finishDownload = resolve
      })
    }),
    quitAndInstall: vi.fn()
  })
  const changed = vi.fn()
  const installer = new LegacyBridgeInstaller(() => updater as unknown as AppUpdater, changed, prepareProfile)
  return { installer, updater, changed, finish: () => finishDownload(), token: () => token }
}

// These cases prevent canceled/failed downloads from reaching the destructive installer handoff.
describe('bridge installation session', () => {
  it('installs exactly once after the pinned download completes, without quitting the gate early', async () => {
    const f = fixture()
    f.installer.start()
    f.installer.start()
    await vi.waitFor(() => expect(f.installer.state.phase).toBe('downloading'))
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    f.updater.emit('download-progress', { total: 100, percent: 40 })
    expect(f.installer.state).toEqual({ phase: 'downloading', percent: 40 })
    f.finish()
    await vi.waitFor(() => expect(f.installer.installing).toBe(true))
    f.installer.start()
    await f.installer.cancel()
    expect(f.updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true)
  })

  it('cancels pending work and ignores late progress and completion', async () => {
    const f = fixture()
    f.installer.start()
    await vi.waitFor(() => expect(f.token()).toBeDefined())
    const cancelled = f.installer.cancel()
    expect(f.token()!.cancelled).toBe(true)
    f.updater.emit('download-progress', { total: 100, percent: 100 })
    expect(f.installer.state.phase).toBe('cancelling')
    f.finish()
    await cancelled
    expect(f.installer.state.phase).toBe('idle')
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    expect(f.updater.listenerCount('download-progress')).toBe(0)
  })

  it('stops on verification failure and allows a fresh retry', async () => {
    const f = fixture()
    f.updater.downloadUpdate.mockRejectedValueOnce(new Error('SHA512 mismatch'))
    f.installer.start()
    await vi.waitFor(() => expect(f.installer.state.phase).toBe('failed'))
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    f.installer.start()
    await vi.waitFor(() => expect(f.installer.state.phase).toBe('downloading'))
    f.finish()
    await vi.waitFor(() => expect(f.installer.installing).toBe(true))
  })

  it('rejects a substituted version before any download', async () => {
    const f = fixture()
    f.updater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: { version: '2.2.0' } })
    f.installer.start()
    await vi.waitFor(() => expect(f.installer.state.phase).toBe('failed'))
    expect(f.updater.downloadUpdate).not.toHaveBeenCalled()
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('recovers from an asynchronous native handoff failure without keeping an install pending', async () => {
    const f = fixture()
    f.installer.start()
    await vi.waitFor(() => expect(f.token()).toBeDefined())
    f.finish()
    await vi.waitFor(() => expect(f.installer.installing).toBe(true))
    f.updater.emit('error', new Error('Signature rejected'))
    expect(f.installer.installing).toBe(false)
    expect(f.installer.state.phase).toBe('failed')
  })

  it('blocks installation when profile handoff cannot be persisted', async () => {
    const f = fixture(() => {
      throw new Error('Read-only BootConfig')
    })
    f.installer.start()
    await vi.waitFor(() => expect(f.token()).toBeDefined())
    f.finish()
    await vi.waitFor(() => expect(f.installer.state.phase).toBe('failed'))
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('restores profile selection after helper failure without changing it during download', async () => {
    let selected = '/original'
    const f = fixture(() => {
      selected = '/custom'
      return () => {
        selected = '/original'
      }
    })
    f.installer.start()
    await vi.waitFor(() => expect(f.token()).toBeDefined())
    expect(selected).toBe('/original')
    f.finish()
    await vi.waitFor(() => expect(f.installer.installing).toBe(true))
    expect(selected).toBe('/custom')
    f.updater.emit('error', new Error('Helper rejected signature'))
    expect(selected).toBe('/original')
    expect(f.installer.state.phase).toBe('failed')
  })

  it('does not install or publish after its window is disposed', async () => {
    const f = fixture()
    f.installer.start()
    await vi.waitFor(() => expect(f.token()).toBeDefined())
    const disposed = f.installer.dispose()
    const published = f.changed.mock.calls.length
    f.finish()
    await disposed
    f.installer.start()
    expect(f.changed).toHaveBeenCalledTimes(published)
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
  })
})
