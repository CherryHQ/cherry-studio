import type { AppEventSchemas } from '@shared/ipc/schemas/app'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ProgressInfo, UpdateInfo } from 'builder-util-runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appUpdateState: { manualCheck: false },
  handlers: new Map<string, (payload: unknown) => void>(),
  loggerError: vi.fn(),
  notificationSend: vi.fn(),
  popupInfo: vi.fn(),
  toastSuccess: vi.fn(),
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
  }
}))

vi.mock('@renderer/services/notification', () => ({
  notificationService: { send: mocks.notificationSend }
}))

vi.mock('@renderer/services/popup', () => ({
  popup: { info: mocks.popupInfo }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { success: mocks.toastSuccess }
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

import { getManualUpdateErrorMessageKey, useAppUpdateHandler } from '../useAppUpdateHandler'

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

function emit<E extends keyof AppEventSchemas>(event: E, payload: AppEventSchemas[E]) {
  const handler = mocks.handlers.get(event)
  if (!handler) {
    throw new Error(`Missing handler for ${event}`)
  }
  act(() => handler(payload))
}

describe('useAppUpdateHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.appUpdateState.manualCheck = false
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

    emit('app.updater.not_available', undefined)
    emit('app.updater.downloaded', releaseInfo)

    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.updateDialogShow).not.toHaveBeenCalled()

    mocks.appUpdateState.manualCheck = true
    rerender()

    emit('app.updater.not_available', undefined)
    emit('app.updater.downloaded', releaseInfo)

    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith('settings.about.updateNotAvailable')
    await waitFor(() => expect(mocks.updateDialogShow).toHaveBeenCalledExactlyOnceWith({ releaseInfo }))
    expect(mocks.updateAppUpdateState).toHaveBeenCalledWith({
      downloading: false,
      info: releaseInfo,
      downloaded: true
    })
  })

  it('always resets failures but only interrupts a manual check with an error popup', () => {
    const { rerender } = renderHook(() => useAppUpdateHandler())

    emit('app.updater.error', new Error('background failure'))
    expect(mocks.popupInfo).not.toHaveBeenCalled()

    mocks.appUpdateState.manualCheck = true
    rerender()
    emit('app.updater.error', new Error('manual failure'))

    expect(mocks.updateAppUpdateState).toHaveBeenLastCalledWith({
      checking: false,
      downloading: false,
      downloadProgress: 0,
      manualCheck: false
    })
    expect(mocks.popupInfo).toHaveBeenCalledExactlyOnceWith({
      title: 'settings.about.updateError',
      content: 'settings.about.updateError',
      icon: null
    })
  })

  it('maps unpublished 503 bodies to a friendly message instead of the raw HTTP response', () => {
    mocks.appUpdateState.manualCheck = true
    renderHook(() => useAppUpdateHandler())

    emit(
      'app.updater.error',
      new Error('HttpError: 503\nnot_published\nCannot download https://releases.cherry-ai.com/latest.yml')
    )

    expect(mocks.popupInfo).toHaveBeenCalledExactlyOnceWith({
      title: 'settings.about.updateError',
      content: 'settings.about.updateNotPublished',
      icon: null
    })
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
