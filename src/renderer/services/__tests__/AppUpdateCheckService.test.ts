import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()
const openExternal = vi.fn()
const updateDialogShow = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => request(...args) }
}))

vi.mock('@renderer/services/website', () => ({
  openExternalWebsite: (...args: unknown[]) => openExternal(...args)
}))

vi.mock('@renderer/components/UpdateDialogPopup', () => ({
  default: { show: (...args: unknown[]) => updateDialogShow(...args) }
}))

import { OFFICIAL_RELEASES_URL, UPDATE_CHECK_EVENT_WAIT_MS } from '../AppUpdateCheckService'
import type * as UpdateCheckModule from '../AppUpdateCheckService'
let appUpdateCheckService: typeof UpdateCheckModule.appUpdateCheckService

function callsTo(channel: string): unknown[][] {
  return request.mock.calls.filter(([name]) => name === channel)
}

const idle = { checking: false, downloading: false, downloaded: false, info: null, manualCheck: false }

function setWindowSource(source: string) {
  let meta = document.querySelector('meta[name="logger-window-source"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'logger-window-source')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', source)
}

describe('runAppUpdateCheck', () => {
  beforeEach(async () => {
    vi.resetModules()
    ;({ appUpdateCheckService } = await import('../AppUpdateCheckService'))

    vi.useRealTimers()
    request.mockReset()
    openExternal.mockReset().mockResolvedValue(undefined)
    updateDialogShow.mockReset().mockResolvedValue(undefined)
    setWindowSource('mainWindow')
  })

  it('does not start a second check while app info is still in flight', async () => {
    let release: (value: { isPortable: boolean }) => void = () => undefined
    request.mockImplementation((channel: string) => {
      if (channel === 'app.get_info') {
        return new Promise((resolve) => {
          release = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    const update = vi.fn()

    const first = appUpdateCheckService.runAppUpdateCheck(idle, update)
    const second = appUpdateCheckService.runAppUpdateCheck(idle, update)
    await Promise.resolve()

    expect(request.mock.calls.filter(([channel]) => channel === 'app.get_info')).toHaveLength(1)
    release({ isPortable: false })
    await first
    await second
    expect(request.mock.calls.filter(([channel]) => channel === 'app.updater.check_for_update')).toHaveLength(1)
  })

  it('opens the official releases page for a portable build and does not call it up to date', async () => {
    request.mockResolvedValue({ isPortable: true })
    const update = vi.fn()

    await appUpdateCheckService.runAppUpdateCheck(idle, update)

    expect(openExternal).toHaveBeenCalledWith(OFFICIAL_RELEASES_URL)
    expect(callsTo('app.updater.check_for_update')).toHaveLength(0)
    expect(callsTo('app.updater.quit_and_install')).toHaveLength(0)
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('shows a local error and the releases page when update info cannot be read', async () => {
    request.mockRejectedValue(new Error('ipc down'))

    await appUpdateCheckService.runAppUpdateCheck(idle, vi.fn())

    expect(appUpdateCheckService.readUpdateNotice()).toBe('settings.about.updateError')
    expect(openExternal).toHaveBeenCalledWith(OFFICIAL_RELEASES_URL)
  })

  it('opens the install dialog for a downloaded update and does not install it', async () => {
    const info = { version: '9.9.9', files: [], path: 'app.zip', sha512: 'x', releaseDate: '2026-01-01' }

    await appUpdateCheckService.runAppUpdateCheck({ ...idle, downloaded: true, info }, vi.fn())

    expect(updateDialogShow).toHaveBeenCalledWith({ releaseInfo: info })
    expect(callsTo('app.updater.quit_and_install')).toHaveLength(0)
    expect(callsTo('app.updater.check_for_update')).toHaveLength(0)
  })

  it('does not confirm a release whose dialog chunk resolves after the channel session is invalidated and acknowledged', async () => {
    const info = { version: '9.9.9', files: [], path: 'app.zip', sha512: 'x', releaseDate: '2026-01-01' }
    const pending = appUpdateCheckService.runAppUpdateCheck({ ...idle, downloaded: true, info }, vi.fn())
    const epoch = appUpdateCheckService.invalidateSharedUpdateCheck()
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(false)

    appUpdateCheckService.resumeSharedUpdateSession(epoch)
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(true)
    appUpdateCheckService.setUpdateNotice('settings.about.updateNotAvailable')
    await pending

    expect(updateDialogShow).not.toHaveBeenCalled()
    expect(appUpdateCheckService.readUpdateNotice()).toBe('settings.about.updateNotAvailable')
    expect(callsTo('app.updater.quit_and_install')).toHaveLength(0)
  })

  it('does not present a downloaded release while the current channel write is held', async () => {
    const info = { version: '9.9.9', files: [], path: 'app.zip', sha512: 'x', releaseDate: '2026-01-01' }
    const epoch = appUpdateCheckService.invalidateSharedUpdateCheck()
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(false)

    await appUpdateCheckService.presentDownloadedUpdate(info)

    expect(updateDialogShow).not.toHaveBeenCalled()
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()

    appUpdateCheckService.resumeSharedUpdateSession(epoch)
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(true)

    await appUpdateCheckService.presentDownloadedUpdate(info)

    expect(updateDialogShow).toHaveBeenCalledTimes(1)
    expect(updateDialogShow).toHaveBeenCalledWith({ releaseInfo: info })
    expect(callsTo('app.updater.quit_and_install')).toHaveLength(0)
  })

  it('does not let a dialog open failure replace the notice of the session that superseded it', async () => {
    const info = { version: '9.9.9', files: [], path: 'app.zip', sha512: 'x', releaseDate: '2026-01-01' }
    updateDialogShow.mockImplementation(async () => {
      const epoch = appUpdateCheckService.invalidateSharedUpdateCheck()
      appUpdateCheckService.resumeSharedUpdateSession(epoch)
      appUpdateCheckService.setUpdateNotice('settings.about.updateNotAvailable')
      throw new Error('chunk failed')
    })

    await appUpdateCheckService.presentDownloadedUpdate(info)

    expect(updateDialogShow).toHaveBeenCalledTimes(1)
    expect(appUpdateCheckService.readUpdateNotice()).toBe('settings.about.updateNotAvailable')
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(true)
  })

  it('keeps a downloaded update retryable when the install dialog fails to open', async () => {
    const info = { version: '9.9.9', files: [], path: 'app.zip', sha512: 'x', releaseDate: '2026-01-01' }
    updateDialogShow.mockRejectedValueOnce(new Error('chunk failed')).mockResolvedValueOnce(undefined)

    await expect(
      appUpdateCheckService.runAppUpdateCheck({ ...idle, downloaded: true, info }, vi.fn())
    ).resolves.toBeUndefined()
    expect(appUpdateCheckService.readUpdateNotice()).toBe('settings.about.updateError')
    expect(callsTo('app.updater.quit_and_install')).toHaveLength(0)

    await appUpdateCheckService.runAppUpdateCheck({ ...idle, downloaded: true, info }, vi.fn())

    expect(updateDialogShow).toHaveBeenCalledTimes(2)
    expect(callsTo('app.updater.quit_and_install')).toHaveLength(0)
  })

  it('clears a stuck checking state when the updater emits nothing', async () => {
    vi.useFakeTimers()
    request.mockImplementation((channel: string) => {
      if (channel === 'app.get_info') return Promise.resolve({ isPortable: false })
      return Promise.resolve(undefined)
    })
    const update = vi.fn()

    const pending = appUpdateCheckService.runAppUpdateCheck(idle, update)
    await vi.advanceTimersByTimeAsync(0)
    await pending
    expect(appUpdateCheckService.isManualUpdateCheck()).toBe(true)

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVENT_WAIT_MS)

    expect(appUpdateCheckService.isManualUpdateCheck()).toBe(false)
    expect(appUpdateCheckService.readUpdateNotice()).toBe('settings.about.updateError')
    expect(update).toHaveBeenCalledWith({
      checking: false,
      downloading: false,
      downloadProgress: 0,
      manualCheck: false
    })
  })

  it('forgets a downloaded release from the previous channel and checks after that write is acknowledged', async () => {
    const info = { version: '1.0.0-beta.1', files: [], path: 'app.zip', sha512: 'x', releaseDate: '2026-01-01' }
    await appUpdateCheckService.runAppUpdateCheck({ ...idle, downloaded: true, info }, vi.fn())
    expect(updateDialogShow).toHaveBeenCalledTimes(1)

    const epoch = appUpdateCheckService.invalidateSharedUpdateCheck()
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(false)
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
    request.mockResolvedValue({ isPortable: false })

    const pending = appUpdateCheckService.runAppUpdateCheck(idle, vi.fn())
    await Promise.resolve()
    expect(callsTo('app.updater.check_for_update')).toHaveLength(0)
    expect(updateDialogShow).toHaveBeenCalledTimes(1)

    appUpdateCheckService.resumeSharedUpdateSession(epoch)
    await pending

    expect(callsTo('app.updater.check_for_update')).toHaveLength(1)
    expect(updateDialogShow).toHaveBeenCalledTimes(1)
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(true)
  })

  it('does not check an intermediate channel when a manual click races queued channel writes', async () => {
    const info = { version: '1.0.0-beta.1', files: [], path: 'app.zip', sha512: 'x', releaseDate: '2026-01-01' }
    const first = appUpdateCheckService.invalidateSharedUpdateCheck()
    const second = appUpdateCheckService.invalidateSharedUpdateCheck()
    request.mockResolvedValue({ isPortable: false })
    const update = vi.fn()

    const pending = appUpdateCheckService.runAppUpdateCheck(
      { ...idle, downloaded: true, manualCheck: true, info },
      update
    )
    const overlapped = appUpdateCheckService.runAppUpdateCheck(
      { ...idle, downloaded: true, manualCheck: true, info },
      update
    )
    await Promise.resolve()

    expect(updateDialogShow).not.toHaveBeenCalled()
    expect(callsTo('app.updater.check_for_update')).toHaveLength(0)
    expect(callsTo('app.get_info')).toHaveLength(0)
    expect(update).not.toHaveBeenCalled()

    appUpdateCheckService.resumeSharedUpdateSession(first)
    appUpdateCheckService.resumeSharedUpdateSession(first - 1)
    await Promise.resolve()
    expect(callsTo('app.updater.check_for_update')).toHaveLength(0)
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(false)

    appUpdateCheckService.resumeSharedUpdateSession(second)
    await pending
    await overlapped

    expect(updateDialogShow).not.toHaveBeenCalled()
    expect(callsTo('app.updater.check_for_update')).toHaveLength(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ checking: true, manualCheck: true })
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(true)
  })

  it('checks the acknowledged channel when the manual click happens after the write settles', async () => {
    const epoch = appUpdateCheckService.invalidateSharedUpdateCheck()
    appUpdateCheckService.resumeSharedUpdateSession(epoch)
    request.mockResolvedValue({ isPortable: false })

    await appUpdateCheckService.runAppUpdateCheck(idle, vi.fn())

    expect(callsTo('app.updater.check_for_update')).toHaveLength(1)
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(true)
  })

  it('resumes a rejected channel write without checking and keeps the inline update error', async () => {
    const superseded = appUpdateCheckService.invalidateSharedUpdateCheck()
    const epoch = appUpdateCheckService.invalidateSharedUpdateCheck()
    request.mockResolvedValue({ isPortable: false })
    const pending = appUpdateCheckService.runAppUpdateCheck(idle, vi.fn())
    await Promise.resolve()

    appUpdateCheckService.noteSharedUpdatePreferenceFailure(superseded)
    await Promise.resolve()
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(false)
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
    expect(callsTo('app.updater.check_for_update')).toHaveLength(0)

    appUpdateCheckService.noteSharedUpdatePreferenceFailure(epoch)
    await pending

    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(true)
    expect(appUpdateCheckService.readUpdateNotice()).toBe('settings.about.updateError')
    expect(callsTo('app.updater.check_for_update')).toHaveLength(0)

    await appUpdateCheckService.runAppUpdateCheck(idle, vi.fn())

    expect(callsTo('app.updater.check_for_update')).toHaveLength(1)
  })

  it('does not arm a manual check whose app info returns after the channel changed', async () => {
    let release: (value: { isPortable: boolean }) => void = () => undefined
    request.mockImplementation((channel: string) => {
      if (channel === 'app.get_info') {
        return new Promise((resolve) => {
          release = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    const update = vi.fn()
    const pending = appUpdateCheckService.runAppUpdateCheck(idle, update)
    await Promise.resolve()
    appUpdateCheckService.invalidateSharedUpdateCheck()
    release({ isPortable: false })
    await pending

    expect(appUpdateCheckService.isManualUpdateCheck()).toBe(false)
    expect(update).not.toHaveBeenCalled()
    expect(callsTo('app.updater.check_for_update')).toHaveLength(0)
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(false)
  })

  it('hands a subwindow click to main and degrades locally when main cannot receive it', async () => {
    setWindowSource('screenshotWindow')
    request.mockRejectedValue(new Error('main unavailable'))

    await appUpdateCheckService.runAppUpdateCheck(idle, vi.fn())

    expect(callsTo('app.updater.present_check')).toHaveLength(1)
    expect(appUpdateCheckService.readUpdateNotice()).toBe('settings.about.updateError')
    expect(openExternal).toHaveBeenCalledWith(OFFICIAL_RELEASES_URL)
  })

  it('checks the latest acknowledged channel once when a later invalidation lets another click wait', async () => {
    const channelA = appUpdateCheckService.invalidateSharedUpdateCheck()
    request.mockResolvedValue({ isPortable: false })
    const update = vi.fn()

    const click1 = appUpdateCheckService.runAppUpdateCheck(idle, update)
    await Promise.resolve()
    const channelB = appUpdateCheckService.invalidateSharedUpdateCheck()
    const click2 = appUpdateCheckService.runAppUpdateCheck(idle, update)
    await Promise.resolve()

    expect(callsTo('app.get_info')).toHaveLength(0)
    appUpdateCheckService.resumeSharedUpdateSession(channelA)
    await Promise.resolve()
    expect(callsTo('app.get_info')).toHaveLength(0)
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(false)

    appUpdateCheckService.resumeSharedUpdateSession(channelB)
    await click1
    await click2

    expect(callsTo('app.get_info')).toHaveLength(1)
    expect(callsTo('app.updater.check_for_update')).toHaveLength(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ checking: true, manualCheck: true })
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(true)
  })

  it('keeps the manual check while check_for_update is still running past the missing-event wait', async () => {
    vi.useFakeTimers()
    let releaseCheck: () => void = () => undefined
    request.mockImplementation((channel: string) => {
      if (channel === 'app.get_info') return Promise.resolve({ isPortable: false })
      if (channel === 'app.updater.check_for_update') {
        return new Promise<void>((resolve) => {
          releaseCheck = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    const update = vi.fn()
    const pending = appUpdateCheckService.runAppUpdateCheck(idle, update)
    await vi.advanceTimersByTimeAsync(0)

    expect(appUpdateCheckService.isManualUpdateCheck()).toBe(true)
    expect(callsTo('app.updater.check_for_update')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVENT_WAIT_MS)

    expect(appUpdateCheckService.isManualUpdateCheck()).toBe(true)
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ checking: true, manualCheck: true })

    const overlapped = appUpdateCheckService.runAppUpdateCheck(idle, update)
    await overlapped
    expect(callsTo('app.updater.check_for_update')).toHaveLength(1)

    releaseCheck()
    await pending
    expect(appUpdateCheckService.isManualUpdateCheck()).toBe(true)
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVENT_WAIT_MS)
    expect(appUpdateCheckService.isManualUpdateCheck()).toBe(false)
    expect(appUpdateCheckService.readUpdateNotice()).toBe('settings.about.updateError')
  })

  it('does not replace a download that arrives during a slow check with the missing-event error', async () => {
    vi.useFakeTimers()
    const info = { version: '9.9.9', files: [], path: 'app.zip', sha512: 'x', releaseDate: '2026-01-01' }
    let releaseCheck: () => void = () => undefined
    request.mockImplementation((channel: string) => {
      if (channel === 'app.get_info') return Promise.resolve({ isPortable: false })
      if (channel === 'app.updater.check_for_update') {
        return new Promise<void>((resolve) => {
          releaseCheck = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    const pending = appUpdateCheckService.runAppUpdateCheck(idle, vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVENT_WAIT_MS)

    expect(appUpdateCheckService.isManualUpdateCheck()).toBe(true)
    appUpdateCheckService.markUpdateDownloaded(info)
    await appUpdateCheckService.presentDownloadedUpdate(info)
    releaseCheck()
    await pending
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVENT_WAIT_MS)

    expect(updateDialogShow).toHaveBeenCalledTimes(1)
    expect(updateDialogShow).toHaveBeenCalledWith({ releaseInfo: info })
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
    expect(callsTo('app.updater.quit_and_install')).toHaveLength(0)
  })

  it('does not arm the missing-event watchdog for a check invalidated before check_for_update settles', async () => {
    vi.useFakeTimers()
    let releaseCheck: () => void = () => undefined
    request.mockImplementation((channel: string) => {
      if (channel === 'app.get_info') return Promise.resolve({ isPortable: false })
      if (channel === 'app.updater.check_for_update') {
        return new Promise<void>((resolve) => {
          releaseCheck = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    const pending = appUpdateCheckService.runAppUpdateCheck(idle, vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVENT_WAIT_MS)
    const epoch = appUpdateCheckService.invalidateSharedUpdateCheck()

    releaseCheck()
    await pending
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVENT_WAIT_MS)

    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(false)
    expect(appUpdateCheckService.isManualUpdateCheck()).toBe(false)
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
    expect(epoch).toBeGreaterThan(0)
  })
})
