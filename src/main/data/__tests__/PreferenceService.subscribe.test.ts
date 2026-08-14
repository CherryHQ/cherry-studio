/**
 * Tests for the Preference_Subscribe IPC handler.
 *
 * The handler must reject when the sender cannot be resolved to a
 * BrowserWindow (instead of silently resolving while dropping the
 * subscription — the renderer would then mark the keys as subscribed and
 * never receive a push), and must register all requested keys for a
 * resolvable window.
 */
import { IpcChannel } from '@shared/IpcChannel'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Undo the global mock from main.setup.ts — we want the REAL PreferenceService
vi.unmock('@main/data/PreferenceService')

// Mock bootConfigService (module-load dependency; the subscribe handler never reads it)
vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    get: vi.fn(),
    set: vi.fn(),
    getAll: vi.fn(() => ({}))
  }
}))

// Unified application mock — these tests skip onInit, so its default services
// suffice; its getPath ('/mock/app.root') backs the sender gate's app-root lookup.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// Sender shapes for the in-handler source-trust gate (validateSender).
const trustedEvent = {
  sender: { getType: () => 'window' },
  senderFrame: { url: 'file:///mock/app.root/index.html', parent: null }
} as unknown as IpcMainInvokeEvent
const untrustedEvent = {
  sender: { getType: () => 'webview' },
  senderFrame: { url: 'file:///mock/app.root/index.html', parent: null }
} as unknown as IpcMainInvokeEvent

// Mock lifecycle decorators so `new PreferenceService()` works without the container.
// The mocked BaseService captures ipcMain handlers we can invoke directly.
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

// Mock Drizzle ORM imports used by PreferenceService
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: any[]) => args),
  eq: vi.fn((a: any, b: any) => [a, b])
}))

// Mock preferenceTable
vi.mock('../db/schemas/preference', () => ({
  preferenceTable: { scope: 'scope', key: 'key' }
}))

// Override electron BrowserWindow with a test-controllable fromWebContents
const fromWebContents = vi.fn()
vi.mock('electron', async () => {
  const actual = await vi.importActual<any>('electron')
  const fakeBrowserWindow: any = vi.fn()
  fakeBrowserWindow.getAllWindows = vi.fn(() => [] as any[])
  fakeBrowserWindow.fromWebContents = fromWebContents
  return {
    ...actual,
    BrowserWindow: fakeBrowserWindow
  }
})

describe('Preference_Subscribe IPC handler', () => {
  let service: any
  let handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown

  beforeEach(async () => {
    vi.clearAllMocks()
    ipcHandlers.clear()

    const { PreferenceService } = await import('../PreferenceService')
    service = new PreferenceService()
    service.onReady()
    handler = ipcHandlers.get(IpcChannel.Preference_Subscribe)!
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects when the sender cannot be resolved to a BrowserWindow', async () => {
    fromWebContents.mockReturnValue(null)

    await expect(Promise.resolve(handler(trustedEvent, ['app.language']))).rejects.toThrow()
    expect(service.getSubscriptions().size).toBe(0)
  })

  it('registers all requested keys for a resolvable window', async () => {
    fromWebContents.mockReturnValue({ id: 42 })

    await handler(trustedEvent, ['app.language', 'ui.theme_mode'])

    expect(service.getSubscriptions().get(42)).toEqual(new Set(['app.language', 'ui.theme_mode']))
  })

  it('rejects untrusted senders on every preference channel before any work', async () => {
    fromWebContents.mockReturnValue({ id: 42 })

    for (const [channel, channelHandler] of ipcHandlers) {
      await expect(
        Promise.resolve().then(() => channelHandler(untrustedEvent, 'app.language')),
        `${channel} must reject an untrusted sender`
      ).rejects.toThrow('untrusted sender')
    }
    expect(service.getSubscriptions().size).toBe(0)
  })
})
