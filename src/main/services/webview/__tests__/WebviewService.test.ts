import { EventEmitter } from 'node:events'

import { WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, type WebviewAnnotation } from '@shared/types/webviewAnnotation'
import type * as FsModule from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { guestById, getWindow, getPath, siteSession, localSession } = vi.hoisted(() => ({
  guestById: new Map<number, unknown>(),
  getWindow: vi.fn(),
  getPath: vi.fn(() => '/app/out/preload/webview.js'),
  siteSession: { setSpellCheckerEnabled: vi.fn() },
  localSession: {}
}))

vi.mock('@application', () => ({
  application: {
    getPath,
    get: (name: string) => {
      if (name === 'WindowManager') return { getWindow }
      throw new Error(`Unexpected service: ${name}`)
    }
  }
}))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))
vi.mock('@main/core/lifecycle', () => ({
  BaseService: class {
    private readonly disposables: Array<() => void> = []
    registerDisposable<T>(disposable: T) {
      if (typeof disposable === 'function') this.disposables.push(disposable as () => void)
      return disposable
    }
  },
  Injectable: () => () => undefined,
  ServicePhase: () => () => undefined,
  Phase: { WhenReady: 'when-ready' }
}))
vi.mock('@main/i18n', () => ({ getAppLanguage: () => 'en-US', t: (key: string) => key }))
vi.mock('../../../utils/externalUrlSafety', () => ({ isSafeExternalUrl: () => true }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>()
  return { ...actual, default: actual, existsSync: () => true }
})
vi.mock('electron', () => ({
  app: { on: vi.fn(), removeListener: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  session: {
    fromPartition: vi.fn((partition: string) => (partition === 'persist:webview' ? siteSession : localSession))
  },
  shell: { openExternal: vi.fn() },
  webContents: { fromId: (id: number) => guestById.get(id), getAllWebContents: vi.fn(() => []) }
}))

import { WebviewService } from '../WebviewService'

interface MockContents extends EventEmitter {
  id: number
  hostWebContents: object | null
  session: object
  debugger: {
    attach: ReturnType<typeof vi.fn>
    detach: ReturnType<typeof vi.fn>
    isAttached: ReturnType<typeof vi.fn>
    sendCommand: ReturnType<typeof vi.fn>
  }
  getTitle: ReturnType<typeof vi.fn>
  getType: ReturnType<typeof vi.fn>
  getURL: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  isDevToolsOpened: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
}

function createContents(
  id: number,
  hostWebContents: object | null,
  options: {
    title?: string
    url?: string
    type?: string
    session?: object
    devToolsOpened?: boolean
    sendCommand?: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  } = {}
): MockContents {
  const contents = new EventEmitter() as MockContents
  let attached = false
  contents.id = id
  contents.hostWebContents = hostWebContents
  contents.session = options.session ?? siteSession
  contents.getTitle = vi.fn(() => options.title ?? 'Example')
  contents.getType = vi.fn(() => options.type ?? 'webview')
  contents.getURL = vi.fn(() => options.url ?? 'https://example.com/page')
  contents.isDestroyed = vi.fn(() => false)
  contents.isDevToolsOpened = vi.fn(() => options.devToolsOpened ?? false)
  contents.send = vi.fn()
  const command = options.sendCommand ?? (async () => ({}))
  contents.debugger = {
    attach: vi.fn(() => {
      attached = true
    }),
    detach: vi.fn(() => {
      attached = false
    }),
    isAttached: vi.fn(() => attached),
    sendCommand: vi.fn((method: string, params?: Record<string, unknown>) => {
      if (method === 'Page.getFrameTree') return Promise.resolve({ frameTree: { frame: { id: 'main-frame' } } })
      if (method === 'Page.createIsolatedWorld') return Promise.resolve({ executionContextId: 73 })
      return command(method, params)
    })
  }
  return contents
}

const annotation = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  comment: 'Fix this',
  element: { selector: '#target', tagName: 'button', text: 'Target', ariaLabel: null, role: 'button' }
}

const initializeReady = (service: WebviewService, guest: MockContents) => {
  ;(service as unknown as { initializeWebview: (contents: Electron.WebContents) => void }).initializeWebview(
    guest as unknown as Electron.WebContents
  )
  guest.emit('dom-ready')
  const command = guest.send.mock.calls.at(-1)?.[1]
  expect(guest.send).toHaveBeenLastCalledWith(
    WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
    expect.objectContaining({ type: 'start_session' })
  )
  return command.sessionId as string
}

const input = (documentSessionId: string, annotations: WebviewAnnotation[] = [annotation]) => ({
  webviewId: 7,
  documentSessionId,
  target: { id: 'mini-app:demo', label: 'Demo' },
  annotations
})

describe('WebviewService webview ownership', () => {
  let service: WebviewService
  let host: object

  beforeEach(() => {
    vi.clearAllMocks()
    guestById.clear()
    host = {}
    getWindow.mockReturnValue({ webContents: host })
    service = new WebviewService()
  })

  it('owns preload and annotation listeners outside BaseService disposables and cleans them on stop', async () => {
    const hostContents = createContents(1, null, { type: 'window' })
    const guest = createContents(7, host)
    ;(service as any).attachWebviewPreload(hostContents)
    initializeReady(service, guest)
    expect(hostContents.listenerCount('will-attach-webview')).toBe(1)
    expect(guest.listenerCount('did-start-navigation')).toBe(1)

    await (service as unknown as { onStop: () => Promise<void> }).onStop()

    expect(hostContents.listenerCount('will-attach-webview')).toBe(0)
    expect(guest.listenerCount('did-start-navigation')).toBe(0)
    expect((service as any).preloadBindings.size).toBe(0)
    expect((service as any).annotationSessions.size).toBe(0)
  })

  it('is idempotent for one identity and replaces a reused numeric id without stale cleanup deleting it', () => {
    const first = createContents(7, host)
    const second = createContents(7, host)
    ;(service as any).initializeWebview(first)
    ;(service as any).initializeWebview(first)
    expect(first.listenerCount('did-start-navigation')).toBe(1)

    ;(service as any).initializeWebview(second)
    expect(first.listenerCount('did-start-navigation')).toBe(0)
    expect(second.listenerCount('did-start-navigation')).toBe(1)
    first.emit('destroyed')
    expect((service as any).annotationSessions.get(7).isFor(second)).toBe(true)
  })

  it('rejects unowned, non-site, stale-session, and duplicate-id exports before accessibility capture', async () => {
    const guest = createContents(7, host)
    guestById.set(7, guest)
    const sessionId = initializeReady(service, guest)

    getWindow.mockReturnValue(undefined)
    await expect(service.exportAnnotations(input(sessionId), 'other')).rejects.toThrow(
      'The caller does not own this webview'
    )
    getWindow.mockReturnValue({ webContents: host })
    guest.session = localSession
    await expect(service.exportAnnotations(input(sessionId), 'owner')).rejects.toThrow(
      'The caller does not own this webview'
    )
    guest.session = siteSession
    await expect(service.exportAnnotations(input('00000000-0000-4000-8000-000000000099'), 'owner')).rejects.toThrow(
      'Annotation document session is stale'
    )
    await expect(service.exportAnnotations(input(sessionId, [annotation, annotation]), 'owner')).rejects.toThrow(
      'Annotation ids must be unique'
    )
    expect(guest.debugger.attach).not.toHaveBeenCalled()
  })

  it('rejects unowned print, save, and spell-check operations before touching the guest', async () => {
    const guest = createContents(7, host)
    guestById.set(7, guest)
    getWindow.mockReturnValue(undefined)

    await expect(service.printWebviewToPDF(7, 'other')).rejects.toThrow('The caller does not own this webview')
    await expect(service.saveWebviewAsHTML(7, 'other')).rejects.toThrow('The caller does not own this webview')
    expect(() => service.setSpellCheckerEnabled(7, false, 'other')).toThrow('The caller does not own this webview')
    expect(siteSession.setSpellCheckerEnabled).not.toHaveBeenCalled()
  })

  it('applies spell-check settings for an owned site webview', () => {
    const guest = createContents(7, host)
    guestById.set(7, guest)

    service.setSpellCheckerEnabled(7, false, 'owner')

    expect(siteSession.setSpellCheckerEnabled).toHaveBeenCalledWith(false)
  })

  it('invalidates an old session on new-document navigation but keeps it for same-document navigation', async () => {
    const guest = createContents(7, host, { devToolsOpened: true })
    guestById.set(7, guest)
    const sessionId = initializeReady(service, guest)
    guest.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    await expect(service.exportAnnotations(input(sessionId), 'owner')).resolves.toContain('Fix this')

    guest.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    await expect(service.exportAnnotations(input(sessionId), 'owner')).rejects.toThrow(
      'Annotation document session is stale'
    )
    guest.emit('did-fail-load', {})
    guest.emit('dom-ready')
    const nextSessionId = guest.send.mock.calls.at(-1)?.[1].sessionId
    expect(nextSessionId).not.toBe(sessionId)
    await expect(service.exportAnnotations(input(nextSessionId), 'owner')).resolves.toContain('Fix this')
  })

  it('discards accessibility results when navigation rotates the session during capture', async () => {
    let release: ((value: unknown) => void) | undefined
    const guest = createContents(7, host, {
      sendCommand: (method) =>
        method === 'Runtime.enable'
          ? new Promise((resolve) => {
              release = resolve
            })
          : Promise.resolve({})
    })
    guestById.set(7, guest)
    const sessionId = initializeReady(service, guest)
    const result = service.exportAnnotations(input(sessionId), 'owner')
    await vi.waitFor(() => expect(guest.debugger.attach).toHaveBeenCalledOnce())

    guest.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    release?.({})

    await expect(result).rejects.toThrow('Annotation document session is stale')
  })

  it('rechecks ownership after asynchronous accessibility capture', async () => {
    let release: ((value: unknown) => void) | undefined
    const guest = createContents(7, host, {
      sendCommand: (method) =>
        method === 'Runtime.enable'
          ? new Promise((resolve) => {
              release = resolve
            })
          : Promise.resolve({})
    })
    guestById.set(7, guest)
    const sessionId = initializeReady(service, guest)
    const result = service.exportAnnotations(input(sessionId), 'owner')
    await vi.waitFor(() => expect(guest.debugger.attach).toHaveBeenCalledOnce())
    getWindow.mockReturnValue({ webContents: {} })
    release?.({})

    await expect(result).rejects.toThrow('The caller does not own this webview')
  })
})
