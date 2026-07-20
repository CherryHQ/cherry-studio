/**
 * Preference_Set / Preference_SetMultiple reject while BACKUP_IN_PROGRESS is held.
 */
import { IpcChannel } from '@shared/IpcChannel'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@main/data/PreferenceService')

vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    get: vi.fn(),
    set: vi.fn(),
    getAll: vi.fn(() => ({}))
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const ipcHandlers = new Map<string, (event: IpcMainInvokeEvent, ...args: any[]) => unknown>()

vi.mock('@main/core/lifecycle', () => ({
  BaseService: class {
    protected ipcHandle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) {
      ipcHandlers.set(channel, handler)
      return { dispose: () => ipcHandlers.delete(channel) }
    }
    protected registerInterval() {
      return { dispose: () => {} }
    }
    protected registerDisposable(d: unknown) {
      return d
    }
    get isReady() {
      return true
    }
  },
  Injectable: () => () => {},
  ServicePhase: () => () => {},
  DependsOn: () => () => {},
  Phase: { BeforeReady: 'BeforeReady', WhenReady: 'WhenReady' }
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: any[]) => args),
  eq: vi.fn((a: any, b: any) => [a, b])
}))

vi.mock('../db/schemas/preference', () => ({
  preferenceTable: { scope: 'scope', key: 'key' }
}))

vi.mock('electron', async () => {
  const actual = await vi.importActual<any>('electron')
  return {
    ...actual,
    BrowserWindow: {
      fromWebContents: vi.fn(() => ({ id: 1 }))
    }
  }
})

import { setBackupInProgress } from '@main/services/backup/quiesceGate'
import { IpcError } from '@shared/ipc/errors/IpcError'

import { PreferenceService } from '../PreferenceService'

const trustedEvent = {
  sender: { getType: () => 'window' },
  senderFrame: { url: 'file:///mock/app.root/index.html', parent: null }
} as unknown as IpcMainInvokeEvent

describe('PreferenceService BACKUP_IN_PROGRESS gate', () => {
  beforeEach(() => {
    ipcHandlers.clear()
    setBackupInProgress(false)
    const svc = new PreferenceService()
    // onReady registers IPC handlers (same path as PreferenceService.subscribe.test).
    ;(svc as unknown as { onReady(): void }).onReady()
  })

  afterEach(() => {
    setBackupInProgress(false)
    ipcHandlers.clear()
  })

  it('rejects Preference_Set while restore quiesce is held', async () => {
    setBackupInProgress(true)
    const handler = ipcHandlers.get(IpcChannel.Preference_Set)!
    await expect(handler(trustedEvent, 'theme', 'dark')).rejects.toSatisfy(
      (e: unknown) => e instanceof IpcError && e.code === 'BACKUP_IN_PROGRESS'
    )
  })

  it('rejects Preference_SetMultiple while restore quiesce is held', async () => {
    setBackupInProgress(true)
    const handler = ipcHandlers.get(IpcChannel.Preference_SetMultiple)!
    await expect(handler(trustedEvent, { theme: 'dark' })).rejects.toSatisfy(
      (e: unknown) => e instanceof IpcError && e.code === 'BACKUP_IN_PROGRESS'
    )
  })

  it('does not gate Preference_Get with BACKUP_IN_PROGRESS', () => {
    setBackupInProgress(true)
    const handler = ipcHandlers.get(IpcChannel.Preference_Get)!
    expect(handler).toBeDefined()
    try {
      handler(trustedEvent, 'theme')
    } catch (e) {
      // Missing store / key may throw — must not be the restore gate.
      expect(e).not.toMatchObject({ code: 'BACKUP_IN_PROGRESS' })
    }
  })
})
