import { pathToFileURL } from 'node:url'

import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcChannel } from '@shared/IpcChannel'

// Undo the global mock from main.setup.ts — we want the REAL PreferenceService
vi.unmock('@main/data/PreferenceService')

// BootConfig is unrelated to these DB-backed preference updates.
vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    get: vi.fn(),
    set: vi.fn(),
    getAll: vi.fn(() => ({}))
  }
}))

// The fake DB records writes; the separate persistence suite uses real SQLite.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const app = mockApplicationFactory()
  return { application: { ...app.application, get: () => ({ getDb: () => db }), getPath: () => '/mock/app.root' } }
})

// Sender shapes for the in-handler source-trust gate (validateSender).
const trustedEvent = {
  sender: { getType: () => 'window' },
  senderFrame: { url: pathToFileURL('/mock/app.root/index.html').href, parent: null }
} as unknown as IpcMainInvokeEvent
const untrustedEvent = {
  sender: { getType: () => 'webview' },
  senderFrame: { url: pathToFileURL('/mock/app.root/index.html').href, parent: null }
} as unknown as IpcMainInvokeEvent

// Mock lifecycle decorators so `new PreferenceService()` works without the container.
// The mocked BaseService captures ipcMain handlers we can invoke directly.
const writes = vi.hoisted(() => ({ run: vi.fn() }))
const db = {
  update: () => ({
    set: (value: unknown) => {
      writes.run(value)
      return { where: () => ({ run: () => {} }) }
    }
  })
}

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

describe('authoritative model setting patches', () => {
  let service: any
  beforeEach(async () => {
    vi.clearAllMocks()
    const { PreferenceService } = await import('../PreferenceService')
    service = new PreferenceService()
    service.cache = {
      ...service.cache,
      'chat.model_settings': {
        'provider::a': { reasoning_effort: 'high', enableWebSearch: true },
        'provider::other': { enableWebSearch: false }
      }
    }
    service.notifyChange = vi.fn(() => new Promise(() => {}))
  })

  it('merges separate window patches before earlier notifications resolve', () => {
    void service.updateModelSettings('provider::a', { reasoning_effort: 'low' })
    void service.updateModelSettings('provider::a', { enableWebSearch: false })
    void service.updateModelSettings('provider::b', { enableWebSearch: true })
    expect(service.get('chat.model_settings')).toEqual({
      'provider::a': { reasoning_effort: 'low', enableWebSearch: false },
      'provider::other': { enableWebSearch: false },
      'provider::b': { enableWebSearch: true }
    })
    expect(writes.run).toHaveBeenCalledTimes(3)
    expect(writes.run.mock.calls[2][0].value).toEqual(service.get('chat.model_settings'))
  })

  it('ignores undefined fields rather than erasing existing choices', () => {
    void service.updateModelSettings('provider::a', { enableWebSearch: false, reasoning_effort: undefined })
    expect(service.get('chat.model_settings')['provider::a']).toEqual({
      enableWebSearch: false,
      reasoning_effort: 'high'
    })
  })

  it.each([
    ['bad', { enableWebSearch: true }],
    ['provider::a', { extra: true }],
    ['provider::a', { enableWebSearch: 'yes' }],
    ['provider::a', { reasoning_effort: 'invalid' }]
  ])('rejects invalid model or settings without writing', async (id, patch) => {
    await expect(service.updateModelSettings(id, patch)).rejects.toThrow()
    expect(writes.run).not.toHaveBeenCalled()
  })

  it('merges trusted independent window calls at the same authoritative boundary', () => {
    service.onReady()
    const handler = ipcHandlers.get(IpcChannel.Preference_UpdateModelSettings)!
    void handler(trustedEvent, 'provider::a', { reasoning_effort: 'low' })
    void handler({ ...trustedEvent, sender: { ...trustedEvent.sender } } as IpcMainInvokeEvent, 'provider::a', {
      enableWebSearch: false
    })
    expect(service.get('chat.model_settings')['provider::a']).toEqual({
      reasoning_effort: 'low',
      enableWebSearch: false
    })
    expect(writes.run).toHaveBeenCalledTimes(2)
  })

  it('rejects an untrusted sender before mutation', async () => {
    service.onReady()
    const handler = ipcHandlers.get(IpcChannel.Preference_UpdateModelSettings)!
    await expect(handler(untrustedEvent, 'provider::a', { enableWebSearch: false })).rejects.toThrow()
    expect(writes.run).not.toHaveBeenCalled()
  })
})
