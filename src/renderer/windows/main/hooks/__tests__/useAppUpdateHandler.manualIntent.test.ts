import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { resetToastMocks } from '@test-mocks/renderer/toast'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { UpdateInfo } from 'builder-util-runtime'
import { beforeEach, expect, it, vi } from 'vitest'

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
  emit('app.updater.available', releaseInfo)
  emit('app.updater.downloaded', releaseInfo)
  await waitFor(() => expect(showDialog).toHaveBeenCalledWith({ releaseInfo }))

  emit('app.updater.not_available', { isCurrent: true })

  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
  expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
})
