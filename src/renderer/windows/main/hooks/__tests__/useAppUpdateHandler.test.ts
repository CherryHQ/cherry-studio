import { act, renderHook, waitFor } from '@testing-library/react'
import type { ProgressInfo, UpdateInfo } from 'builder-util-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppEventSchemas } from '@shared/ipc/schemas/app'

const currentPayload: AppEventSchemas['app.updater.not_available'] = { isCurrent: true }

const withheldPayload: AppEventSchemas['app.updater.not_available'] = { isCurrent: false }

const mocks = vi.hoisted(() => ({
  appUpdateState: { manualCheck: false },
  handlers: new Map<string, (payload: unknown) => void>(),
  loggerError: vi.fn(),
  notificationSend: vi.fn(),
  popupInfo: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  ipcRequest: vi.fn(),
  updateAppUpdateState: vi.fn(),
  updateDialogShow: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: mocks.loggerError })
  }
}))

vi.mock('@renderer/hooks/useAppUpdateState', () => ({
  useAppUpdateState: () => ({
    appUpdateState: mocks.appUpdateState,
    updateAppUpdateState: mocks.updateAppUpdateState
  })
}))

vi.mock('@renderer/ipc', () => ({
  useIpcOn: (event: string, handler: (payload: unknown) => void) => {
    mocks.handlers.set(event, handler)
  },
  ipcApi: { request: (...args: unknown[]) => mocks.ipcRequest(...args) }
}))

vi.mock('@renderer/services/notification', () => ({
  notificationService: { send: mocks.notificationSend }
}))

vi.mock('@renderer/services/popup', () => ({
  popup: { info: mocks.popupInfo }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError }
}))

vi.mock('@renderer/utils/uuid', () => ({
  uuid: () => 'notification-id'
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { version?: string }) => (options?.version ? `${key}:${options.version}` : key)
  })
}))

vi.mock('@renderer/components/UpdateDialogPopup', () => ({
  default: { show: mocks.updateDialogShow }
}))

import { UPDATE_CHECK_EVENT_WAIT_MS } from '@renderer/services/AppUpdateCheckService'
import type * as UpdateCheckModule from '@renderer/services/AppUpdateCheckService'
let appUpdateCheckService: typeof UpdateCheckModule.appUpdateCheckService

import type * as HandlerModule from '../useAppUpdateHandler'
let getManualUpdateErrorMessageKey: typeof HandlerModule.getManualUpdateErrorMessageKey
let useAppUpdateHandler: typeof HandlerModule.useAppUpdateHandler

beforeEach(async () => {
  vi.resetModules()
  ;({ appUpdateCheckService } = await import('@renderer/services/AppUpdateCheckService'))
  ;({ getManualUpdateErrorMessageKey, useAppUpdateHandler } = await import('../useAppUpdateHandler'))
})

const releaseInfo: UpdateInfo = {
  version: '2.1.0',
  files: [],
  path: 'Cherry-Studio.dmg',
  sha512: 'checksum',
  releaseDate: '2026-07-30T00:00:00.000Z'
}

const progress: ProgressInfo = {
  bytesPerSecond: 1024,
  delta: 2048,
  percent: 100,
  total: 2048,
  transferred: 2048
}

function setWindowSource(source: string) {
  let meta = document.querySelector('meta[name="logger-window-source"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'logger-window-source')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', source)
}

function emit<E extends keyof AppEventSchemas>(event: E, payload: AppEventSchemas[E]) {
  const handler = mocks.handlers.get(event)
  if (!handler) {
    throw new Error(`Missing handler for ${event}`)
  }
  act(() => handler(payload))
}

describe('useAppUpdateHandler', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.appUpdateState.manualCheck = false
    mocks.ipcRequest.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('maps available and progress events to the update state and notification', () => {
    renderHook(() => useAppUpdateHandler())

    emit('app.updater.available', releaseInfo)
    emit('app.updater.download_progress', progress)

    expect(mocks.notificationSend).toHaveBeenCalledWith({
      id: 'notification-id',
      type: 'info',
      title: 'button.update_available',
      message: 'button.update_available:2.1.0',
      timestamp: expect.any(Number),
      source: 'update'
    })
    expect(mocks.updateAppUpdateState).toHaveBeenNthCalledWith(1, {
      checking: false,
      downloading: true,
      info: releaseInfo,
      available: true
    })
    expect(mocks.updateAppUpdateState).toHaveBeenNthCalledWith(2, {
      downloading: false,
      downloadProgress: 100
    })
  })

  it('uses the latest manual-check state to surface no-update and downloaded results', async () => {
    const { rerender } = renderHook(() => useAppUpdateHandler())

    emit('app.updater.not_available', currentPayload)
    emit('app.updater.downloaded', releaseInfo)

    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.updateDialogShow).not.toHaveBeenCalled()

    mocks.appUpdateState.manualCheck = true
    rerender()

    emit('app.updater.not_available', currentPayload)
    emit('app.updater.downloaded', releaseInfo)

    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith('settings.about.updateNotAvailable')
    await waitFor(() => expect(mocks.updateDialogShow).toHaveBeenCalledExactlyOnceWith({ releaseInfo }))
    expect(mocks.updateAppUpdateState).toHaveBeenCalledWith({
      downloading: false,
      info: releaseInfo,
      downloaded: true
    })
  })

  it('never reports a withheld feed as up to date and leaves the official-download notice', () => {
    mocks.appUpdateState.manualCheck = true
    renderHook(() => useAppUpdateHandler())

    emit('app.updater.not_available', withheldPayload)

    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith({
      title: 'settings.about.updateNotPublished',
      data: { suppressDetail: true }
    })
    expect(appUpdateCheckService.readUpdateNotice()).toBe('settings.about.updateNotPublished')
  })

  it('stays silent about a withheld feed for background checks', () => {
    renderHook(() => useAppUpdateHandler())

    emit('app.updater.not_available', withheldPayload)

    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
    expect(mocks.updateAppUpdateState).toHaveBeenCalledWith({ checking: false, manualCheck: false })
  })

  it('falls back to the up-to-date result on a version-skewed void payload', () => {
    mocks.appUpdateState.manualCheck = true
    renderHook(() => useAppUpdateHandler())

    emit('app.updater.not_available', undefined as unknown as AppEventSchemas['app.updater.not_available'])

    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith('settings.about.updateNotAvailable')
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('does not open a downloaded release after the channel session is acknowledged while the dialog chunk loads', async () => {
    mocks.appUpdateState.manualCheck = true
    renderHook(() => useAppUpdateHandler())
    const downloaded = mocks.handlers.get('app.updater.downloaded')
    if (!downloaded) throw new Error('missing downloaded handler')

    const presented = vi.spyOn(appUpdateCheckService, 'presentDownloadedUpdate')
    try {
      downloaded(releaseInfo)
      const presentation = presented.mock.results[0]?.value
      if (!(presentation instanceof Promise)) throw new Error('presentDownloadedUpdate did not return its promise')
      const epoch = appUpdateCheckService.invalidateSharedUpdateCheck()
      expect(appUpdateCheckService.isActiveUpdateSession()).toBe(false)
      appUpdateCheckService.resumeSharedUpdateSession(epoch)
      expect(appUpdateCheckService.isActiveUpdateSession()).toBe(true)
      appUpdateCheckService.setUpdateNotice('settings.about.updateNotAvailable')
      await presentation

      expect(mocks.updateDialogShow).not.toHaveBeenCalled()
      expect(appUpdateCheckService.readUpdateNotice()).toBe('settings.about.updateNotAvailable')
      expect(mocks.updateAppUpdateState).toHaveBeenCalledWith({
        downloading: false,
        info: releaseInfo,
        downloaded: true
      })
    } finally {
      presented.mockRestore()
    }
  })

  it('keeps the downloaded update retryable when the install dialog fails to open', async () => {
    mocks.appUpdateState.manualCheck = true
    mocks.updateDialogShow.mockRejectedValueOnce(new Error('chunk failed'))
    renderHook(() => useAppUpdateHandler())

    emit('app.updater.downloaded', releaseInfo)

    await waitFor(() => expect(appUpdateCheckService.readUpdateNotice()).toBe('settings.about.updateError'))
    expect(mocks.updateAppUpdateState).toHaveBeenCalledWith(
      expect.objectContaining({ downloaded: true, info: releaseInfo })
    )
  })

  it('drops the previous channel artifact until that write settles, then accepts a background check', () => {
    mocks.appUpdateState.manualCheck = true
    renderHook(() => useAppUpdateHandler())
    const epoch = appUpdateCheckService.invalidateSharedUpdateCheck()

    emit('app.updater.downloaded', releaseInfo)
    emit('app.updater.available', releaseInfo)

    expect(mocks.updateDialogShow).not.toHaveBeenCalled()
    expect(mocks.updateAppUpdateState).not.toHaveBeenCalled()
    expect(mocks.notificationSend).not.toHaveBeenCalled()

    mocks.appUpdateState.manualCheck = false
    appUpdateCheckService.resumeSharedUpdateSession(epoch)
    emit('app.updater.downloaded', releaseInfo)

    expect(mocks.updateDialogShow).not.toHaveBeenCalled()
    expect(mocks.updateAppUpdateState).toHaveBeenCalledWith({
      downloading: false,
      info: releaseInfo,
      downloaded: true
    })
  })

  it('always resets failures and keeps a manual failure beside the check control', () => {
    const { rerender } = renderHook(() => useAppUpdateHandler())

    emit('app.updater.error', new Error('background failure'))
    expect(mocks.popupInfo).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()

    mocks.appUpdateState.manualCheck = true
    rerender()
    emit('app.updater.error', new Error('manual failure'))

    expect(mocks.updateAppUpdateState).toHaveBeenLastCalledWith({
      checking: false,
      downloading: false,
      downloadProgress: 0,
      manualCheck: false
    })
    expect(mocks.popupInfo).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith({
      title: 'settings.about.updateError',
      data: { suppressDetail: true }
    })
  })

  it('maps unpublished 503 bodies to a friendly message instead of the raw HTTP response', () => {
    mocks.appUpdateState.manualCheck = true
    renderHook(() => useAppUpdateHandler())

    emit(
      'app.updater.error',
      new Error('HttpError: 503\nnot_published\nCannot download https://releases.cherry-ai.com/latest.yml')
    )

    expect(mocks.popupInfo).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith({
      title: 'settings.about.updateNotPublished',
      data: { suppressDetail: true }
    })
    expect(mocks.ipcRequest.mock.calls.map(([channel]) => channel)).not.toContain('system.shell.open_external_website')
  })

  it('keeps a slow manual check able to show the updater error and does not open releases for it', async () => {
    vi.useFakeTimers()
    let releaseCheck: () => void = () => undefined
    mocks.ipcRequest.mockImplementation((channel: string) => {
      if (channel === 'app.get_info') return Promise.resolve({ isPortable: false })
      if (channel === 'app.updater.check_for_update') {
        return new Promise<void>((resolve) => {
          releaseCheck = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    setWindowSource('mainWindow')
    renderHook(() => useAppUpdateHandler())

    emit('app.updater.run_check', undefined)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVENT_WAIT_MS)
    })

    expect(appUpdateCheckService.isManualUpdateCheck()).toBe(true)
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
    emit('app.updater.run_check', undefined)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mocks.ipcRequest.mock.calls.filter(([channel]) => channel === 'app.updater.check_for_update')).toHaveLength(
      1
    )

    emit('app.updater.error', new Error('still checking'))
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith({
      title: 'settings.about.updateError',
      data: { suppressDetail: true }
    })
    expect(appUpdateCheckService.readUpdateNotice()).toBe('settings.about.updateError')
    expect(mocks.ipcRequest.mock.calls.map(([channel]) => channel)).not.toContain('system.shell.open_external_website')
    expect(mocks.updateDialogShow).not.toHaveBeenCalled()

    releaseCheck()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVENT_WAIT_MS)
    })
    expect(appUpdateCheckService.readUpdateNotice()).toBe('settings.about.updateError')
    expect(mocks.ipcRequest.mock.calls.filter(([channel]) => channel === 'app.updater.check_for_update')).toHaveLength(
      1
    )
  })

  it('opens the install dialog when the download finishes after the check IPC outlasts the missing-event wait', async () => {
    vi.useFakeTimers()
    let releaseCheck: () => void = () => undefined
    mocks.ipcRequest.mockImplementation((channel: string) => {
      if (channel === 'app.get_info') return Promise.resolve({ isPortable: false })
      if (channel === 'app.updater.check_for_update') {
        return new Promise<void>((resolve) => {
          releaseCheck = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    mocks.updateDialogShow.mockResolvedValue(undefined)
    setWindowSource('mainWindow')
    renderHook(() => useAppUpdateHandler())

    emit('app.updater.run_check', undefined)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVENT_WAIT_MS)
    })
    expect(appUpdateCheckService.isManualUpdateCheck()).toBe(true)

    emit('app.updater.downloaded', releaseInfo)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mocks.updateDialogShow).toHaveBeenCalledExactlyOnceWith({ releaseInfo })
    releaseCheck()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVENT_WAIT_MS)
    })
    expect(mocks.updateDialogShow).toHaveBeenCalledTimes(1)
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
  })

  it('drops a late download when the channel session is invalidated during a slow manual check', async () => {
    vi.useFakeTimers()
    let releaseCheck: () => void = () => undefined
    mocks.ipcRequest.mockImplementation((channel: string) => {
      if (channel === 'app.get_info') return Promise.resolve({ isPortable: false })
      if (channel === 'app.updater.check_for_update') {
        return new Promise<void>((resolve) => {
          releaseCheck = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    setWindowSource('mainWindow')
    renderHook(() => useAppUpdateHandler())

    emit('app.updater.run_check', undefined)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVENT_WAIT_MS)
    })
    appUpdateCheckService.invalidateSharedUpdateCheck()
    const callsBeforeDownload = mocks.updateAppUpdateState.mock.calls.length
    emit('app.updater.downloaded', releaseInfo)
    expect(mocks.updateDialogShow).not.toHaveBeenCalled()
    expect(mocks.updateAppUpdateState.mock.calls.length).toBe(callsBeforeDownload)

    releaseCheck()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVENT_WAIT_MS)
    })
    expect(mocks.updateDialogShow).not.toHaveBeenCalled()
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(false)
  })
})

describe('getManualUpdateErrorMessageKey', () => {
  it('classifies unpublished release artifacts without exposing the updater body', () => {
    expect(getManualUpdateErrorMessageKey(new Error('503 not_published'))).toBe('settings.about.updateNotPublished')
    expect(getManualUpdateErrorMessageKey(new Error('HttpError: 503 Cannot find latest.yml'))).toBe(
      'settings.about.updateNotPublished'
    )
    expect(
      getManualUpdateErrorMessageKey(new Error('<html>503 not_published</html>\nPlease report this issue to GitHub'))
    ).toBe('settings.about.updateNotPublished')
  })

  it('falls back to the generic update error for unrelated failures', () => {
    expect(getManualUpdateErrorMessageKey(new Error('manual failure'))).toBe('settings.about.updateError')
    expect(getManualUpdateErrorMessageKey(new Error('ENOTFOUND releases.cherry-ai.com'))).toBe(
      'settings.about.updateError'
    )
    expect(getManualUpdateErrorMessageKey(undefined)).toBe('settings.about.updateError')
  })
})
