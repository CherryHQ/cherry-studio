import type { BackupEventSchemas } from '@shared/ipc/schemas/backup'
import type { AutoBackupSnapshot, AutoBackupType } from '@shared/types/backup'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => void>(),
  loggerError: vi.fn(),
  notificationSend: vi.fn(),
  request: vi.fn(),
  states: {
    webdav: { lastSyncTime: null, syncing: false, lastSyncError: null },
    s3: { lastSyncTime: null, syncing: false, lastSyncError: null },
    local: { lastSyncTime: null, syncing: false, lastSyncError: null },
    nutstore: { lastSyncTime: null, syncing: false, lastSyncError: null }
  } as Record<AutoBackupType, { lastSyncTime: number | null; syncing: boolean; lastSyncError: string | null }>,
  toastError: vi.fn(),
  toastWarning: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request },
  useIpcOn: (event: string, handler: (payload: unknown) => void) => {
    mocks.handlers.set(event, handler)
  }
}))

vi.mock('@renderer/services/BackupService', () => ({
  getBackupSyncState: () => mocks.states,
  setBackupSyncState: (
    type: AutoBackupType,
    patch: Partial<{ lastSyncTime: number | null; syncing: boolean; lastSyncError: string | null }>
  ) => {
    mocks.states[type] = { ...mocks.states[type], ...patch }
  }
}))

vi.mock('@renderer/services/notification', () => ({
  notificationService: { send: mocks.notificationSend }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError, warning: mocks.toastWarning }
}))

vi.mock('@renderer/utils/backup', () => ({
  getLocalizedBackupErrorMessage: (error: Error) => `localized:${error.message}`
}))

vi.mock('@renderer/utils/uuid', () => ({ uuid: () => 'notification-id' }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { useAutoBackupEvents } from '../useAutoBackupEvents'

const emptySuccessTimes = { webdav: null, s3: null, local: null, nutstore: null }

function emit<E extends keyof BackupEventSchemas>(event: E, payload: BackupEventSchemas[E]) {
  const handler = mocks.handlers.get(event)
  if (!handler) throw new Error(`Missing handler for ${event}`)
  act(() => handler(payload))
}

describe('useAutoBackupEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    for (const type of ['webdav', 's3', 'local', 'nutstore'] as const) {
      mocks.states[type] = { lastSyncTime: null, syncing: false, lastSyncError: null }
    }
  })

  it('hydrates the last success without turning a later failure into a success', async () => {
    const snapshot: AutoBackupSnapshot = {
      lastSuccessTimes: { ...emptySuccessTimes, webdav: 100 },
      events: [{ id: 100, type: 'webdav', status: 'failed', timestamp: 200, errorMessage: 'upload failed' }],
      pendingNotifications: []
    }
    mocks.request.mockResolvedValue(snapshot)

    renderHook(() => useAutoBackupEvents({ notificationsEnabled: true }))
    await waitFor(() => expect(mocks.states.webdav.lastSyncError).toBe('localized:upload failed'))

    expect(mocks.states.webdav).toEqual({
      lastSyncTime: 100,
      syncing: false,
      lastSyncError: 'localized:upload failed'
    })
  })

  it('updates detached-window state without duplicating notifications or acknowledgements', async () => {
    const snapshot: AutoBackupSnapshot = {
      lastSuccessTimes: emptySuccessTimes,
      events: [],
      pendingNotifications: []
    }
    mocks.request.mockResolvedValue(snapshot)

    renderHook(() => useAutoBackupEvents({ notificationsEnabled: false }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('backup.get_auto_sync_state'))

    emit('backup.auto_sync_state_changed', { id: 200, type: 's3', status: 'succeeded', timestamp: 300 })
    emit('backup.auto_sync_state_changed', {
      id: 201,
      type: 'local',
      status: 'warning',
      timestamp: 301,
      reason: 'cleanup_failed'
    })

    expect(mocks.states.s3.lastSyncTime).toBe(300)
    expect(mocks.states.local).toEqual({
      lastSyncTime: 301,
      syncing: false,
      lastSyncError: 'message.backup.cleanup_failed'
    })
    expect(mocks.notificationSend).not.toHaveBeenCalled()
    expect(mocks.toastWarning).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalledWith('backup.acknowledge_auto_sync_notification', expect.anything())
  })

  it('leaves warning notification ownership with the main window', async () => {
    const warning = {
      id: 300,
      type: 'nutstore',
      status: 'warning',
      timestamp: 400,
      reason: 'cleanup_failed'
    } as const
    const snapshot: AutoBackupSnapshot = {
      lastSuccessTimes: { ...emptySuccessTimes, nutstore: 400 },
      events: [warning],
      pendingNotifications: [warning]
    }
    mocks.request.mockResolvedValue(snapshot)

    renderHook(() => useAutoBackupEvents({ notificationsEnabled: true }))
    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalledOnce())

    expect(mocks.request).toHaveBeenCalledWith('backup.acknowledge_auto_sync_notification', {
      type: 'nutstore',
      id: 300
    })
  })
})
