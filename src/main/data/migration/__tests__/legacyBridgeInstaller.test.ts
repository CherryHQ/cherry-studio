import { EventEmitter } from 'node:events'

import type { CancellationToken } from 'builder-util-runtime'
import { type AppUpdater, PortableUpdater } from 'electron-updater'
import { describe, expect, it, vi } from 'vitest'

import { LegacyBridgeInstaller } from '../legacyBridgeInstaller'
import type { LegacyBridgeVersion } from '../legacyBridgeTarget'

function fixture(prepareProfile?: () => () => void, version: LegacyBridgeVersion = '2.1.0') {
  let finishDownload!: (files: string[]) => void
  let token: CancellationToken | undefined
  const updateInfo: { version: string } = { version }
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: true, updateInfo })),
    downloadUpdate: vi.fn((next: CancellationToken) => {
      token = next
      return new Promise<string[]>((resolve) => {
        finishDownload = resolve
      })
    }),
    quitAndInstall: vi.fn()
  })
  const changed = vi.fn()
  const installer = new LegacyBridgeInstaller(version, () => updater as unknown as AppUpdater, changed, prepareProfile)
  return { installer, updater, changed, finish: () => finishDownload(['/cache/package.exe']), token: () => token }
}

function portableChain() {
  const source = fixture(undefined, '1.9.12').updater
  const next = fixture().updater
  Object.setPrototypeOf(source, PortableUpdater.prototype)
  const portable = source as unknown as PortableUpdater
  const bridgeFile = '/cache/bridge.exe'
  const versionLog = '/data/version.log'
  const createUpdater = vi.fn(() => next as unknown as AppUpdater)
  const installer = new LegacyBridgeInstaller('1.9.12', () => portable, vi.fn(), undefined, {
    version: '2.1.0',
    sha512: 'pinned-bridge-hash',
    versionLog,
    createUpdater
  })
  return { source, portable, next, installer, createUpdater, bridgeFile, versionLog }
}

// These cases prevent canceled/failed downloads from reaching the destructive installer handoff.
describe('bridge installation session', () => {
  it.each(['1.9.12', '2.1.0'] as const)('installs pinned %s exactly once after download completes', async (version) => {
    const f = fixture(undefined, version)
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

  it('downloads both pinned packages before handing off to the portable worker', async () => {
    const f = portableChain()
    let completeBridge!: (files: string[]) => void
    f.source.downloadUpdate.mockResolvedValue(['/cache/prerequisite.exe'])
    f.next.downloadUpdate.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          completeBridge = resolve
        })
    )
    f.installer.start()
    await vi.waitFor(() => expect(f.next.downloadUpdate).toHaveBeenCalledOnce())
    expect(f.source.quitAndInstall).not.toHaveBeenCalled()
    expect(f.installer.state).toEqual({ phase: 'downloading', percent: 50 })
    completeBridge([f.bridgeFile])
    await vi.waitFor(() => expect(f.source.quitAndInstall).toHaveBeenCalledOnce())
    expect(f.portable.portableFollowup).toEqual({
      source: f.bridgeFile,
      sha512: 'pinned-bridge-hash',
      versionLog: f.versionLog,
      prerequisiteVersion: '1.9.12'
    })
  })

  it('keeps the running portable app when the follow-up download fails', async () => {
    const f = portableChain()
    f.source.downloadUpdate.mockResolvedValue(['/cache/prerequisite.exe'])
    f.next.downloadUpdate.mockRejectedValue(new Error('Follow-up download failed'))
    f.installer.start()
    await vi.waitFor(() => expect(f.installer.state.phase).toBe('failed'))
    expect(f.source.quitAndInstall).not.toHaveBeenCalled()
    expect(f.next.listenerCount('error')).toBe(0)
  })

  it('rejects the migration release when the selected stage is the prerequisite', async () => {
    const f = fixture(undefined, '1.9.12')
    f.updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '2.1.0' } })
    f.installer.start()
    await vi.waitFor(() => expect(f.installer.state.phase).toBe('failed'))
    expect(f.updater.downloadUpdate).not.toHaveBeenCalled()
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
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
