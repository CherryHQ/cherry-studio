import { EventEmitter } from 'node:events'

import { WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, type WebviewAnnotation } from '@shared/types/webviewAnnotation'
import { shell } from 'electron'
import type * as FsModule from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getBrowserService,
  guestById,
  getAllWebContents,
  getWindow,
  getPath,
  siteSession,
  localSession,
  agentSessions
} = vi.hoisted(() => ({
  getBrowserService: vi.fn(),
  agentSessions: new Map<string, { setSpellCheckerEnabled: ReturnType<typeof vi.fn> }>(),
  guestById: new Map<number, unknown>(),
  getAllWebContents: vi.fn(() => [] as unknown[]),
  getWindow: vi.fn(),
  getPath: vi.fn(() => '/app/out/preload/webview.js'),
  siteSession: {
    getUserAgent: vi.fn(() => 'CherryStudio/1.0 Electron/1.0 Browser/1.0'),
    setUserAgent: vi.fn(),
    setSpellCheckerEnabled: vi.fn(),
    webRequest: { onBeforeSendHeaders: vi.fn() }
  },
  localSession: { setSpellCheckerEnabled: vi.fn() }
}))

vi.mock('@application', () => ({
  application: {
    getPath,
    get: (name: string) => {
      if (name === 'BrowserSessionService') return getBrowserService()
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
  DependsOn: () => () => undefined,
  Phase: { WhenReady: 'when-ready' },
  LifecycleState: { Stopping: 'stopping' }
}))
vi.mock('@main/i18n', () => ({ getAppLanguage: () => 'en-US', t: (key: string) => key }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>()
  return { ...actual, default: actual, existsSync: () => true }
})
vi.mock('electron', () => ({
  app: { on: vi.fn(), removeListener: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  session: {
    fromPartition: vi.fn((partition: string) => {
      if (partition === 'persist:webview') return siteSession
      // Agent browser partitions are annotation-capable and must stay distinct
      // from the local mini app session the non-site rejection cases use.
      if (partition.startsWith('agent-')) {
        let agentSession = agentSessions.get(partition)
        if (!agentSession) {
          agentSession = { setSpellCheckerEnabled: vi.fn() }
          agentSessions.set(partition, agentSession)
        }
        return agentSession
      }
      return localSession
    })
  },
  shell: { openExternal: vi.fn() },
  webContents: { fromId: (id: number) => guestById.get(id), getAllWebContents }
}))

import { BrowserSessionService } from '@main/features/browser'

import { WebviewService } from '../WebviewService'

let browserService: BrowserSessionService
beforeEach(() => {
  browserService = new BrowserSessionService()
  getBrowserService.mockReturnValue(browserService)
})
afterEach(() => {
  ;(browserService as unknown as { onStop(): void }).onStop()
})

interface MockContents extends EventEmitter {
  id: number
  hostWebContents: object | null
  session: object
  debugger: EventEmitter & {
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
  isLoadingMainFrame: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  setWindowOpenHandler: ReturnType<typeof vi.fn>
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
    loadingMainFrame?: boolean
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
  contents.isLoadingMainFrame = vi.fn(() => options.loadingMainFrame ?? false)
  contents.send = vi.fn()
  contents.setWindowOpenHandler = vi.fn()
  const command = options.sendCommand ?? (async () => ({}))
  contents.debugger = Object.assign(new EventEmitter(), {
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
  })
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
    getAllWebContents.mockReturnValue([])
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

  it('reannounces a loaded surviving guest with a new session after restart', async () => {
    const guest = createContents(7, host)
    guestById.set(7, guest)
    getAllWebContents.mockReturnValue([guest])

    await (service as unknown as { onInit: () => Promise<void> }).onInit()
    const firstSessionId = guest.send.mock.calls.at(-1)?.[1].sessionId as string
    expect(guest.send).toHaveBeenCalledOnce()

    await (service as unknown as { onStop: () => Promise<void> }).onStop()
    expect(guest.listenerCount('dom-ready')).toBe(0)
    await (service as unknown as { onInit: () => Promise<void> }).onInit()

    const secondSessionId = guest.send.mock.calls.at(-1)?.[1].sessionId as string
    expect(guest.send).toHaveBeenCalledTimes(2)
    expect(secondSessionId).not.toBe(firstSessionId)
    expect(guest.listenerCount('dom-ready')).toBe(1)

    await expect(service.exportAnnotations(input(firstSessionId), 'owner')).rejects.toThrow(
      'Annotation document session is stale'
    )
    expect(guest.debugger.attach).not.toHaveBeenCalled()
    await expect(service.exportAnnotations(input(secondSessionId), 'owner')).resolves.toContain('Fix this')
    expect(guest.debugger.attach).toHaveBeenCalledOnce()
  })

  it('aborts and detaches a pending export before stop allows a restart', async () => {
    const guest = createContents(7, host, {
      sendCommand: () => new Promise(() => undefined)
    })
    guestById.set(7, guest)
    getAllWebContents.mockReturnValue([guest])
    const firstSessionId = initializeReady(service, guest)
    const firstExport = service.exportAnnotations(input(firstSessionId), 'owner')
    const firstOutcome = firstExport.then(
      () => 'resolved',
      (error: Error) => error.message
    )
    await vi.waitFor(() => expect(guest.debugger.attach).toHaveBeenCalledOnce())

    const stop = (service as unknown as { onStop: () => Promise<void> }).onStop()

    await vi.waitFor(() => expect(guest.debugger.detach).toHaveBeenCalledOnce(), { timeout: 200, interval: 5 })
    await stop
    await expect(firstOutcome).resolves.toBe('Annotation document session is stale')

    await (service as unknown as { onInit: () => Promise<void> }).onInit()
    const secondSessionId = guest.send.mock.calls.at(-1)?.[1].sessionId as string
    guest.debugger.sendCommand.mockImplementation(async (method: string) => {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main-frame' } } }
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 73 }
      return {}
    })
    await expect(service.exportAnnotations(input(secondSessionId), 'owner')).resolves.toContain('Fix this')
    expect(guest.debugger.attach).toHaveBeenCalledTimes(2)
  })

  it('waits for dom-ready before announcing an existing guest that is still loading', async () => {
    const guest = createContents(7, host, { loadingMainFrame: true })
    getAllWebContents.mockReturnValue([guest])

    await (service as unknown as { onInit: () => Promise<void> }).onInit()
    expect(guest.send).not.toHaveBeenCalled()

    guest.emit('dom-ready')
    expect(guest.send).toHaveBeenCalledOnce()
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

  it.each([
    ['site webview', siteSession],
    ['local mini app', localSession]
  ])('applies spell-check settings for an owned %s', (_label, guestSession) => {
    const guest = createContents(7, host, { session: guestSession })
    guestById.set(7, guest)

    service.setSpellCheckerEnabled(7, false, 'owner')

    expect(guestSession.setSpellCheckerEnabled).toHaveBeenCalledWith(false)
  })

  it('ignores best-effort guest settings after the guest has detached', () => {
    expect(() => service.setSpellCheckerEnabled(7, false, 'owner')).not.toThrow()
    expect(() => service.setOpenLinkExternal(7, true, 'owner')).not.toThrow()

    const destroyedGuest = createContents(7, host)
    destroyedGuest.isDestroyed.mockReturnValue(true)
    guestById.set(7, destroyedGuest)

    expect(() => service.setSpellCheckerEnabled(7, false, 'owner')).not.toThrow()
    expect(() => service.setOpenLinkExternal(7, true, 'owner')).not.toThrow()
    expect(siteSession.setSpellCheckerEnabled).not.toHaveBeenCalled()
    expect(destroyedGuest.setWindowOpenHandler).not.toHaveBeenCalled()
  })

  it('changes popup policy only for an owned site webview', () => {
    const guest = createContents(7, host)
    guestById.set(7, guest)

    service.setOpenLinkExternal(7, true, 'owner')
    expect(guest.setWindowOpenHandler).toHaveBeenCalledOnce()
    const externalHandler = guest.setWindowOpenHandler.mock.calls[0][0]
    expect(externalHandler({ url: 'https://cherrystudio.com/page' })).toEqual({ action: 'deny' })
    expect(shell.openExternal).toHaveBeenCalledWith('https://cherrystudio.com/page')
    expect(externalHandler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(shell.openExternal).toHaveBeenCalledOnce()

    service.setOpenLinkExternal(7, false, 'owner')
    const inAppHandler = guest.setWindowOpenHandler.mock.calls[1][0]
    expect(inAppHandler({ url: 'https://cherrystudio.com/page' })).toEqual({ action: 'allow' })
    expect(inAppHandler({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' })

    getWindow.mockReturnValue(undefined)
    expect(() => service.setOpenLinkExternal(7, false, 'other')).toThrow('The caller does not own this webview')
    expect(guest.setWindowOpenHandler).toHaveBeenCalledTimes(2)

    getWindow.mockReturnValue({ webContents: host })
    guest.session = localSession
    expect(() => service.setOpenLinkExternal(7, false, 'owner')).toThrow('The caller does not own this webview')
    expect(guest.setWindowOpenHandler).toHaveBeenCalledTimes(2)
  })

  it('restores a failed navigation and rotates only after a successful new-document navigation', async () => {
    const guest = createContents(7, host, { devToolsOpened: true })
    guestById.set(7, guest)
    const sessionId = initializeReady(service, guest)
    guest.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: true,
      url: 'https://example.com/page#section'
    })
    await expect(service.exportAnnotations(input(sessionId), 'owner')).resolves.toContain('Fix this')

    guest.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://example.com/blocked'
    })
    await expect(service.exportAnnotations(input(sessionId), 'owner')).rejects.toThrow(
      'Annotation document session is stale'
    )
    guest.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://example.com/blocked', true)
    await expect(service.exportAnnotations(input(sessionId), 'owner')).resolves.toContain('Fix this')

    guest.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://example.com/next'
    })
    guest.emit('did-navigate', {}, 'https://example.com/next')
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
