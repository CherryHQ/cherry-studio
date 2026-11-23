import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { resetToastMocks } from '@test-mocks/renderer/toast'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { UpdateInfo } from 'builder-util-runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => void>(),
  request: vi.fn()
}))

vi.unmock('@data/hooks/useCache')

vi.mock('@renderer/ipc', () => ({
  useIpcOn: (event: string, handler: (payload: unknown) => void) => {
    mocks.handlers.set(event, handler)
  },
  ipcApi: { request: (...args: unknown[]) => mocks.request(...args) }
}))

import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { appUpdateCheckService } from '@renderer/services/AppUpdateCheckService'

import { useAppUpdateHandler } from '../useAppUpdateHandler'

const releaseInfo: UpdateInfo = {
  version: '2.1.0',
  files: [],
  path: 'Cherry-Studio.dmg',
  sha512: 'checksum',
  releaseDate: '2026-07-30T00:00:00.000Z'
}

function emit(event: string, payload: unknown) {
  const handler = mocks.handlers.get(event)
  if (!handler) throw new Error(`Missing handler for ${event}`)
  act(() => handler(payload))
}

beforeEach(() => {
  MockCacheUtils.resetMocks()
  resetToastMocks()
  mocks.handlers.clear()
  // The service is a module singleton; free its check slot for each test.
  appUpdateCheckService.endManualUpdateCheck()
  appUpdateCheckService.setUpdateNotice(null)
  mocks.request.mockImplementation(async (route: string) =>
    route === 'app.get_info' ? { isPortable: false } : undefined
  )
  const meta = document.querySelector('meta[name="logger-window-source"]') ?? document.createElement('meta')
  meta.setAttribute('name', 'logger-window-source')
  meta.setAttribute('content', 'mainWindow')
  document.head.appendChild(meta)
})

it('stays silent about a scheduled no-update result after a manual download finished', async () => {
  const showDialog = vi.fn().mockResolvedValue(undefined)
  const { result } = renderHook(() => {
    useAppUpdateHandler()
    return useAppUpdateState()
  })
  appUpdateCheckService.registerUpdateDialog(async () => ({ show: showDialog }))

  await act(() =>
    appUpdateCheckService.runAppUpdateCheck(result.current.appUpdateState, result.current.updateAppUpdateState)
  )
  emit('app.updater.check_started', { manual: true })
  emit('app.updater.available', releaseInfo)
  emit('app.updater.downloaded', releaseInfo)
  await waitFor(() => expect(showDialog).toHaveBeenCalledWith({ releaseInfo }))

  emit('app.updater.check_started', { manual: false })
  emit('app.updater.not_available', { isCurrent: true })

  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
  expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
})

it('retries a newer release whose download failed instead of confirming it with an earlier download', async () => {
  const showDialog = vi.fn().mockResolvedValue(undefined)
  const { result } = renderHook(() => {
    useAppUpdateHandler()
    return useAppUpdateState()
  })
  appUpdateCheckService.registerUpdateDialog(async () => ({ show: showDialog }))
  const newer = { ...releaseInfo, version: '2.2.0' }

  emit('app.updater.downloaded', releaseInfo)
  emit('app.updater.available', newer)
  emit('app.updater.error', new Error('download failed'))
  await act(() =>
    appUpdateCheckService.runAppUpdateCheck(result.current.appUpdateState, result.current.updateAppUpdateState)
  )

  expect(showDialog).not.toHaveBeenCalled()
  expect(mocks.request).toHaveBeenCalledWith('app.updater.check_for_update')
})

describe('a click queued behind a slow scheduled check', () => {
  const newer = { ...releaseInfo, version: '2.2.0' }

  async function clickDuringScheduledCheck() {
    const showDialog = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => {
      useAppUpdateHandler()
      return useAppUpdateState()
    })
    appUpdateCheckService.registerUpdateDialog(async () => ({ show: showDialog }))
    emit('app.updater.check_started', { manual: false })
    await act(() =>
      appUpdateCheckService.runAppUpdateCheck(result.current.appUpdateState, result.current.updateAppUpdateState)
    )
    emit('app.updater.not_available', { isCurrent: true })
    return showDialog
  }

  it('does not answer the click with the scheduled result', async () => {
    await clickDuringScheduledCheck()

    expect(toast.success).not.toHaveBeenCalled()
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
  })

  it('reports the up-to-date result once the click gets its own check', async () => {
    await clickDuringScheduledCheck()
    emit('app.updater.check_started', { manual: true })
    emit('app.updater.not_available', { isCurrent: true })

    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(appUpdateCheckService.readUpdateNotice()).toBe('settings.about.updateNotAvailable')
  })

  it('confirms installation of a newer release its own check downloads', async () => {
    const showDialog = await clickDuringScheduledCheck()
    emit('app.updater.check_started', { manual: true })
    emit('app.updater.available', newer)
    emit('app.updater.downloaded', newer)

    await waitFor(() => expect(showDialog).toHaveBeenCalledWith({ releaseInfo: newer }))
  })
})
