import { EventEmitter } from 'node:events'

import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  WEBVIEW_ANNOTATION_LIMITS,
  type WebviewAnnotation
} from '@shared/types/webviewAnnotation'
import type * as FsModule from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ACCESSIBILITY_TIMEOUT_MS = 5_001
const { guestById, getWindow, getPath, siteSession, localSession } = vi.hoisted(() => ({
  guestById: new Map<number, unknown>(),
  getWindow: vi.fn(),
  getPath: vi.fn(() => '/app/out/preload/webview.js'),
  siteSession: {},
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

describe('WebviewService annotation document ownership', () => {
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

  it('sanitizes page metadata and exports only the request-scoped snapshot', async () => {
    const guest = createContents(7, host, {
      title: '  Private   dashboard  ',
      url: 'https://user:secret@example.com/account?token=secret#billing',
      devToolsOpened: true
    })
    guestById.set(7, guest)
    const sessionId = initializeReady(service, guest)

    const markdown = await service.exportAnnotations(input(sessionId), 'owner')

    expect(markdown).toContain('- Page: Private dashboard')
    expect(markdown).toContain('- URL: `https://example.com/account`')
    expect(markdown).toContain('> Fix this')
    expect(markdown).not.toContain('secret')
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

describe('WebviewService accessibility export safety', () => {
  let service: WebviewService
  let host: object

  beforeEach(() => {
    vi.clearAllMocks()
    guestById.clear()
    host = {}
    getWindow.mockReturnValue({ webContents: host })
    service = new WebviewService()
  })

  it('uses the isolated world and excludes value-bearing descendants and protocol values', async () => {
    const sendCommand = vi.fn(async (method: string) => {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'selected' } }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 101 } }
      if (method === 'Accessibility.getAXNodeAndAncestors') {
        return {
          nodes: [
            {
              nodeId: 'selected',
              ignored: false,
              role: { value: 'textbox' },
              name: { value: 'Email' },
              properties: [
                { name: 'editable', value: { value: true } },
                { name: 'value', value: { value: 'SECRET' } }
              ],
              childIds: ['secret'],
              backendDOMNodeId: 101,
              frameId: 'main-frame'
            }
          ]
        }
      }
      if (method === 'Accessibility.getChildAXNodes') {
        return { nodes: [{ nodeId: 'secret', ignored: false, role: { value: 'text' }, name: { value: 'SECRET' } }] }
      }
      return {}
    })
    const guest = createContents(7, host, { sendCommand })
    guestById.set(7, guest)
    const sessionId = initializeReady(service, guest)

    const markdown = await service.exportAnnotations(
      input(sessionId, [{ ...annotation, element: { ...annotation.element, tagName: 'input' } }]),
      'owner'
    )

    expect(markdown).toContain('name=Email')
    expect(markdown).not.toContain('SECRET')
    expect(sendCommand).not.toHaveBeenCalledWith('Accessibility.getChildAXNodes', expect.anything())
    expect(guest.debugger.sendCommand).toHaveBeenCalledWith('Page.createIsolatedWorld', {
      frameId: 'main-frame',
      worldName: 'cherry-webview-annotation-accessibility',
      grantUniveralAccess: false
    })
  })

  it('does not descend into selected iframes or include nodes from another frame', async () => {
    const iframe = {
      ...annotation,
      id: '123e4567-e89b-42d3-a456-426614174001',
      element: { ...annotation.element, selector: '#frame', tagName: 'iframe' }
    }
    const button = {
      ...annotation,
      id: '123e4567-e89b-42d3-a456-426614174002',
      element: { ...annotation.element, selector: '#button' }
    }
    const sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Runtime.evaluate') {
        return { result: { objectId: String(params?.expression).includes('#frame') ? 'frame' : 'button' } }
      }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: params?.objectId === 'frame' ? 201 : 202 } }
      if (method === 'Accessibility.getAXNodeAndAncestors') {
        const isFrame = params?.backendNodeId === 201
        return {
          nodes: [
            {
              nodeId: isFrame ? 'frame' : 'button',
              ignored: false,
              role: { value: isFrame ? 'Iframe' : 'button' },
              childIds: ['same', 'cross'],
              backendDOMNodeId: params?.backendNodeId,
              frameId: 'main-frame'
            }
          ]
        }
      }
      if (method === 'Accessibility.getChildAXNodes') {
        return {
          nodes: [
            {
              nodeId: 'same',
              ignored: false,
              role: { value: 'text' },
              name: { value: 'Same frame' },
              childIds: [],
              frameId: 'main-frame'
            },
            {
              nodeId: 'cross',
              ignored: false,
              role: { value: 'document' },
              name: { value: 'CROSS FRAME SECRET' },
              childIds: [],
              frameId: 'remote-frame'
            }
          ]
        }
      }
      return {}
    })
    const guest = createContents(7, host, { sendCommand })
    guestById.set(7, guest)
    const sessionId = initializeReady(service, guest)

    const markdown = await service.exportAnnotations(input(sessionId, [iframe, button]), 'owner')

    expect(markdown).toContain('Same frame')
    expect(markdown).not.toContain('CROSS FRAME SECRET')
    expect(sendCommand.mock.calls.filter(([method]) => method === 'Accessibility.getChildAXNodes')).toHaveLength(1)
  })

  it('enforces the request node budget without dropping later annotations', async () => {
    const annotations = Array.from({ length: 6 }, (_, index) => ({
      ...annotation,
      id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`,
      comment: `Annotation ${index}`
    }))
    const leaves = Array.from({ length: 100 }, (_, index) => ({
      nodeId: `leaf-${index}`,
      ignored: false,
      role: { value: 'text' },
      name: { value: `Leaf ${index}` },
      childIds: [],
      frameId: 'main-frame'
    }))
    const sendCommand = vi.fn(async (method: string) => {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'selected' } }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 301 } }
      if (method === 'Accessibility.getAXNodeAndAncestors') {
        return {
          nodes: [
            {
              nodeId: 'selected',
              ignored: false,
              role: { value: 'group' },
              childIds: leaves.map((node) => node.nodeId),
              backendDOMNodeId: 301,
              frameId: 'main-frame'
            }
          ]
        }
      }
      if (method === 'Accessibility.getChildAXNodes') return { nodes: leaves }
      return {}
    })
    const guest = createContents(7, host, { sendCommand })
    guestById.set(7, guest)
    const sessionId = initializeReady(service, guest)

    const markdown = await service.exportAnnotations(input(sessionId, annotations), 'owner')

    expect(markdown.match(/^### \d+\. Annotation$/gm)).toHaveLength(6)
    expect(markdown).toContain('Accessibility status: `budget_exceeded`')
  })

  it('returns timeout/capture fallbacks and always detaches its debugger', async () => {
    vi.useFakeTimers()
    try {
      const guest = createContents(7, host, {
        sendCommand: (method) => (method === 'Runtime.enable' ? new Promise(() => undefined) : Promise.resolve({}))
      })
      guestById.set(7, guest)
      const sessionId = initializeReady(service, guest)
      const result = service.exportAnnotations(input(sessionId), 'owner')
      await vi.advanceTimersByTimeAsync(ACCESSIBILITY_TIMEOUT_MS)
      await expect(result).resolves.toContain('Accessibility status: `timeout`')
      expect(guest.debugger.detach).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }

    const failedGuest = createContents(8, host, {
      sendCommand: async (method) => {
        if (method === 'Runtime.evaluate') throw new Error('protocol details must not leak')
        return {}
      }
    })
    guestById.set(8, failedGuest)
    const failedSessionId = initializeReady(service, failedGuest)
    const markdown = await service.exportAnnotations({ ...input(failedSessionId), webviewId: 8 }, 'owner')
    expect(markdown).toContain('Accessibility status: `capture_failed`')
    expect(markdown).not.toContain('protocol details')
    expect(failedGuest.debugger.detach).toHaveBeenCalledOnce()
  })

  it('caps oversized exports at complete annotation blocks', async () => {
    const guest = createContents(7, host, { devToolsOpened: true })
    guestById.set(7, guest)
    const sessionId = initializeReady(service, guest)
    const largeLocator = {
      ...annotation.element,
      selector: `#${'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.selector - 1)}`,
      text: 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.text),
      ariaLabel: 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.ariaLabel),
      role: 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.role)
    }
    const annotations = Array.from({ length: WEBVIEW_ANNOTATION_LIMITS.annotations }, (_, index) => ({
      ...annotation,
      id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`,
      comment: 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.comment),
      element: largeLocator,
      region: {
        rect: { x: 0, y: 0, width: 100, height: 100 },
        elements: Array.from({ length: WEBVIEW_ANNOTATION_LIMITS.regionElements }, () => largeLocator)
      }
    }))

    const markdown = await service.exportAnnotations(input(sessionId, annotations), 'owner')
    const headings = markdown.match(/^### \d+\. Annotation$/gm) ?? []
    expect(markdown.length).toBeLessThanOrEqual(WEBVIEW_ANNOTATION_LIMITS.exportMarkdown)
    expect(headings.length).toBeGreaterThan(0)
    expect(markdown).toMatch(/> Output truncated: \d+ annotations omitted\.$/)
  })
})
