import { EventEmitter } from 'node:events'

import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  type WebviewAnnotation,
  type WebviewAnnotationDocument,
  type WebviewResolvedAnnotationDocument
} from '@shared/types/webviewAnnotation'
import type * as FsModule from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ACCESSIBILITY_CAPTURE_TIMEOUT_MS_FOR_TEST = 5_001

const { cacheValues, guestById, getWindow, getPath, siteSession, localSession } = vi.hoisted(() => ({
  cacheValues: new Map<string, unknown>(),
  guestById: new Map<number, unknown>(),
  getWindow: vi.fn(),
  getPath: vi.fn(() => '/app/out/preload/webview.js'),
  siteSession: {},
  localSession: {}
}))

const cacheService = {
  get: vi.fn((key: string) => cacheValues.get(key)),
  set: vi.fn((key: string, value: unknown) => cacheValues.set(key, value)),
  delete: vi.fn((key: string) => cacheValues.delete(key))
}

vi.mock('@application', () => ({
  application: {
    getPath,
    get: (name: string) => {
      if (name === 'CacheService') return cacheService
      if (name === 'WindowManager') return { getWindow }
      throw new Error(`Unexpected service: ${name}`)
    }
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
  }
}))

vi.mock('@main/core/lifecycle', () => ({
  BaseService: class {
    private readonly disposables: Array<() => void> = []

    registerDisposable<T>(disposable: T) {
      if (typeof disposable === 'function') this.disposables.push(disposable as () => void)
      return disposable
    }

    disposeRegistered() {
      for (const dispose of this.disposables.splice(0).reverse()) dispose()
    }
  },
  Injectable: () => () => undefined,
  ServicePhase: () => () => undefined,
  Phase: { WhenReady: 'when-ready' }
}))

vi.mock('@main/i18n', () => ({ getAppLanguage: () => 'en-US', t: (key: string) => key }))
vi.mock('../../utils/externalUrlSafety', () => ({ isSafeExternalUrl: () => true }))
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
  webContents: {
    fromId: (id: number) => guestById.get(id),
    getAllWebContents: vi.fn(() => [])
  }
}))

import { WebviewService } from '../WebviewService'

const annotationInternals = (service: WebviewService) =>
  service as unknown as {
    listAnnotations: () => WebviewAnnotationDocument[]
    resolveStoredAnnotationDocuments: (
      documents: WebviewAnnotationDocument[]
    ) => Promise<WebviewResolvedAnnotationDocument[]>
  }

const listAnnotations = (service: WebviewService, targetId?: string) =>
  annotationInternals(service)
    .listAnnotations()
    .filter((document) => !targetId || document.target.id === targetId)

const resolveAnnotationsWithAccessibility = (service: WebviewService, targetId?: string) =>
  annotationInternals(service).resolveStoredAnnotationDocuments(listAnnotations(service, targetId))

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
  getType: () => string
  getTitle: () => string
  getURL: () => string
  isDevToolsOpened: () => boolean
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
}

function createContents(
  id: number,
  hostWebContents: object | null,
  options: {
    title?: string
    url?: string
    destroyed?: boolean
    type?: string
    devToolsOpened?: boolean
    debuggerAttached?: boolean
    sendCommand?: ReturnType<typeof vi.fn>
    session?: object
  } = {}
): MockContents {
  const contents = new EventEmitter() as MockContents
  let debuggerAttached = options.debuggerAttached ?? false
  const delegateSendCommand = options.sendCommand ?? vi.fn().mockResolvedValue({})
  contents.id = id
  contents.hostWebContents = hostWebContents
  contents.session = options.session ?? siteSession
  contents.debugger = {
    attach: vi.fn(() => {
      debuggerAttached = true
    }),
    detach: vi.fn(() => {
      debuggerAttached = false
    }),
    isAttached: vi.fn(() => debuggerAttached),
    sendCommand: vi.fn((method: string, params?: Record<string, unknown>) => {
      if (method === 'Page.getFrameTree') return Promise.resolve({ frameTree: { frame: { id: 'main-frame' } } })
      if (method === 'Page.createIsolatedWorld') return Promise.resolve({ executionContextId: 73 })
      return delegateSendCommand(method, params)
    })
  }
  contents.getType = () => options.type ?? 'webview'
  contents.getTitle = () => options.title ?? 'Example'
  contents.getURL = () => options.url ?? 'https://example.com/page'
  contents.isDevToolsOpened = () => options.devToolsOpened ?? false
  contents.isDestroyed = () => options.destroyed ?? false
  contents.send = vi.fn()
  return contents
}

const annotation: WebviewAnnotation = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  comment: 'Fix this',
  createdAt: 1,
  element: {
    selector: '#target',
    tagName: 'button',
    text: 'Target',
    ariaLabel: null,
    role: 'button'
  }
}

describe('WebviewService annotation security and lifecycle', () => {
  let service: WebviewService

  beforeEach(() => {
    cacheValues.clear()
    guestById.clear()
    getWindow.mockReset()
    getPath.mockClear()
    vi.clearAllMocks()
    service = new WebviewService()
  })

  it('replaces a custom preload and enforces isolated guest preferences', () => {
    const host = createContents(1, null, { type: 'window' })
    ;(service as any).attachWebviewPreload(host)
    const preferences: Record<string, unknown> = {
      preload: '/tmp/evil.js',
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    }

    host.emit('will-attach-webview', {}, preferences, { partition: 'persist:webview' })

    expect(preferences).toMatchObject({
      preload: '/app/out/preload/webview.js',
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true
    })
  })

  it('does not replace the local mini app capability bridge preload', () => {
    const host = createContents(1, null, { type: 'window' })
    ;(service as any).attachWebviewPreload(host)
    const preferences = { preload: '/app/out/preload/miniAppBridge.js', sandbox: true }

    host.emit('will-attach-webview', {}, preferences, { partition: 'persist:miniapp:com.example.app' })

    expect(preferences).toEqual({ preload: '/app/out/preload/miniAppBridge.js', sandbox: true })
  })

  it('can reattach listeners after lifecycle cleanup', () => {
    const host = createContents(1, null, { type: 'window' })
    ;(service as any).attachWebviewPreload(host)
    expect(host.listenerCount('will-attach-webview')).toBe(1)

    ;(service as any).disposeRegistered()
    expect(host.listenerCount('will-attach-webview')).toBe(0)

    ;(service as any).attachWebviewPreload(host)
    expect(host.listenerCount('will-attach-webview')).toBe(1)
  })

  it('can reinitialize guest listeners after lifecycle cleanup', () => {
    const guest = createContents(7, {})
    ;(service as any).initializeWebview(guest)
    expect(guest.listenerCount('did-start-navigation')).toBe(1)

    ;(service as any).disposeRegistered()
    expect(guest.listenerCount('did-start-navigation')).toBe(0)

    ;(service as any).initializeWebview(guest)
    expect(guest.listenerCount('did-start-navigation')).toBe(1)
  })

  it('accepts snapshots only from the window that owns the webview and sanitizes page metadata', () => {
    const hostWebContents = {}
    const guest = createContents(7, hostWebContents, {
      title: '  Private   dashboard  ',
      url: 'https://user:secret@example.com/account?token=secret#billing'
    })
    guestById.set(7, guest)
    getWindow.mockImplementation((id: string) => (id === 'owner' ? { webContents: hostWebContents } : undefined))

    service.replaceAnnotations(
      {
        webviewId: 7,
        navigationRevision: 0,
        target: { id: 'mini-app:demo', label: 'Demo' },
        annotations: [annotation]
      },
      'owner'
    )

    expect(listAnnotations(service)).toEqual([
      expect.objectContaining({
        webviewId: 7,
        page: { title: 'Private dashboard', url: 'https://example.com/account' },
        annotations: [annotation]
      })
    ])
    expect(() =>
      service.replaceAnnotations(
        {
          webviewId: 7,
          navigationRevision: 0,
          target: { id: 'mini-app:demo', label: 'Demo' },
          annotations: [annotation]
        },
        'other'
      )
    ).toThrow('The caller does not own this webview')
  })

  it('rejects annotation access to a local mini app guest even when the host owns it', () => {
    const hostWebContents = {}
    const guest = createContents(7, hostWebContents, { session: localSession })
    guestById.set(7, guest)
    getWindow.mockReturnValue({ webContents: hostWebContents })

    expect(() =>
      service.replaceAnnotations(
        {
          webviewId: 7,
          navigationRevision: 0,
          target: { id: 'mini-app:local', label: 'Local' },
          annotations: [annotation]
        },
        'owner'
      )
    ).toThrow('The caller does not own this webview')
  })

  it('isolates snapshots by webview id across windows and filters by target', () => {
    const hostOne = {}
    const hostTwo = {}
    guestById.set(7, createContents(7, hostOne))
    guestById.set(8, createContents(8, hostTwo))
    getWindow.mockImplementation((id: string) => ({
      webContents: id === 'window-one' ? hostOne : hostTwo
    }))

    service.replaceAnnotations(
      {
        webviewId: 7,
        navigationRevision: 0,
        target: { id: 'mini-app:one', label: 'One' },
        annotations: [annotation]
      },
      'window-one'
    )
    service.replaceAnnotations(
      {
        webviewId: 8,
        navigationRevision: 0,
        target: { id: 'mini-app:two', label: 'Two' },
        annotations: [annotation]
      },
      'window-two'
    )

    expect(listAnnotations(service)).toHaveLength(2)
    expect(listAnnotations(service, 'mini-app:one').map((item) => item.webviewId)).toEqual([7])

    service.clearAnnotations(7)
    expect(listAnnotations(service).map((item) => item.webviewId)).toEqual([8])
  })

  it('clears annotations on main-frame navigation and destroyed guests', () => {
    const host = {}
    const guest = createContents(7, host)
    guestById.set(7, guest)
    getWindow.mockReturnValue({ webContents: host })
    service.replaceAnnotations(
      {
        webviewId: 7,
        navigationRevision: 0,
        target: { id: 'mini-app:demo', label: 'Demo' },
        annotations: [annotation]
      },
      'owner'
    )

    ;(service as any).initializeWebview(guest)
    guest.emit('did-start-navigation', { isMainFrame: false })
    expect(listAnnotations(service)).toHaveLength(1)
    guest.emit('did-start-navigation', { isMainFrame: true })
    expect(listAnnotations(service)).toHaveLength(0)

    const destroyedGuest = createContents(8, host, { destroyed: true })
    guestById.set(8, destroyedGuest)
    cacheValues.set('webview.annotations', {
      '8': {
        webviewId: 8,
        target: { id: 'mini-app:stale', label: 'Stale' },
        page: { title: 'Stale', url: 'https://example.com' },
        annotations: [annotation],
        updatedAt: 1
      }
    })
    expect(listAnnotations(service)).toEqual([])
  })

  it('rejects delayed snapshots invalidated by main-frame navigation', () => {
    const host = {}
    const guest = createContents(7, host)
    const target = { id: 'mini-app:demo', label: 'Demo' }
    guestById.set(7, guest)
    getWindow.mockReturnValue({ webContents: host })

    service.replaceAnnotations({ webviewId: 7, navigationRevision: 0, target, annotations: [annotation] }, 'owner')
    ;(service as any).initializeWebview(guest)

    guest.emit('did-start-navigation', { isMainFrame: true })
    expect(listAnnotations(service)).toEqual([])

    service.replaceAnnotations({ webviewId: 7, navigationRevision: 0, target, annotations: [annotation] }, 'owner')
    expect(listAnnotations(service)).toEqual([])

    const currentAnnotation = {
      ...annotation,
      id: '123e4567-e89b-12d3-a456-426614174001'
    }
    service.replaceAnnotations(
      { webviewId: 7, navigationRevision: 1, target, annotations: [currentAnnotation] },
      'owner'
    )
    expect(listAnnotations(service)).toEqual([expect.objectContaining({ annotations: [currentAnnotation] })])
    expect(guest.send).toHaveBeenCalledWith(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, {
      type: 'reset_for_navigation',
      navigationRevision: 1
    })

    guest.send.mockClear()
    guest.emit('dom-ready')
    expect(guest.send).toHaveBeenCalledWith(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, {
      type: 'reset_for_navigation',
      navigationRevision: 1
    })

    guest.send.mockClear()
    guest.emit('did-start-navigation', { isMainFrame: true })
    expect(listAnnotations(service)).toEqual([])
    expect(guest.send).toHaveBeenCalledWith(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, {
      type: 'reset_for_navigation',
      navigationRevision: 2
    })

    service.replaceAnnotations(
      { webviewId: 7, navigationRevision: 1, target, annotations: [currentAnnotation] },
      'owner'
    )
    expect(listAnnotations(service)).toEqual([])

    const nextAnnotation = {
      ...annotation,
      id: '123e4567-e89b-12d3-a456-426614174002'
    }
    service.replaceAnnotations({ webviewId: 7, navigationRevision: 2, target, annotations: [nextAnnotation] }, 'owner')
    expect(listAnnotations(service)).toEqual([expect.objectContaining({ annotations: [nextAnnotation] })])
  })

  it('rejects delayed snapshots invalidated by a renderer crash', () => {
    const host = {}
    const guest = createContents(7, host)
    const target = { id: 'mini-app:demo', label: 'Demo' }
    guestById.set(7, guest)
    getWindow.mockReturnValue({ webContents: host })

    service.replaceAnnotations({ webviewId: 7, navigationRevision: 0, target, annotations: [annotation] }, 'owner')
    ;(service as any).initializeWebview(guest)

    guest.emit('render-process-gone')
    expect(listAnnotations(service)).toEqual([])

    service.replaceAnnotations({ webviewId: 7, navigationRevision: 0, target, annotations: [annotation] }, 'owner')
    expect(listAnnotations(service)).toEqual([])

    const currentAnnotation = {
      ...annotation,
      id: '123e4567-e89b-12d3-a456-426614174001'
    }
    service.replaceAnnotations(
      { webviewId: 7, navigationRevision: 1, target, annotations: [currentAnnotation] },
      'owner'
    )
    expect(listAnnotations(service)).toEqual([expect.objectContaining({ annotations: [currentAnnotation] })])
  })

  it('allows a stale revision to clear the current snapshot', () => {
    const host = {}
    const guest = createContents(7, host)
    const target = { id: 'mini-app:demo', label: 'Demo' }
    guestById.set(7, guest)
    getWindow.mockReturnValue({ webContents: host })
    ;(service as any).initializeWebview(guest)

    guest.emit('did-start-navigation', { isMainFrame: true })
    service.replaceAnnotations({ webviewId: 7, navigationRevision: 1, target, annotations: [annotation] }, 'owner')
    expect(listAnnotations(service)).toHaveLength(1)

    service.replaceAnnotations({ webviewId: 7, navigationRevision: 0, target, annotations: [] }, 'owner')
    expect(listAnnotations(service)).toEqual([])
  })

  it('starts a replacement webview instance at revision zero after destruction', () => {
    const host = {}
    const originalGuest = createContents(7, host)
    const target = { id: 'mini-app:demo', label: 'Demo' }
    guestById.set(7, originalGuest)
    getWindow.mockReturnValue({ webContents: host })
    ;(service as any).initializeWebview(originalGuest)

    originalGuest.emit('did-start-navigation', { isMainFrame: true })
    originalGuest.emit('destroyed')

    const replacementGuest = createContents(7, host)
    guestById.set(7, replacementGuest)
    ;(service as any).initializeWebview(replacementGuest)
    service.replaceAnnotations({ webviewId: 7, navigationRevision: 0, target, annotations: [annotation] }, 'owner')

    expect(listAnnotations(service)).toEqual([expect.objectContaining({ annotations: [annotation] })])
  })

  it('captures the computed AX path and subtree while excluding values and collapsing ignored nodes', async () => {
    const host = {}
    const shadowAnnotation: WebviewAnnotation = {
      ...annotation,
      element: {
        ...annotation.element,
        selector: '#host >>> [data-testid="submit"]'
      }
    }
    const sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'selected-object' } }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 101 } }
      if (method === 'Accessibility.getAXNodeAndAncestors') {
        return {
          nodes: [
            {
              nodeId: 'selected',
              ignored: false,
              role: { value: 'button' },
              name: { value: 'Computed submit' },
              description: { value: 'Submits the checkout form' },
              value: { value: 'SECRET_VALUE' },
              properties: [
                { name: 'disabled', value: { value: true } },
                { name: 'valuetext', value: { value: 'SECRET_VALUE' } },
                { name: 'controls', value: { value: 'payment-panel' } }
              ],
              childIds: ['ignored'],
              backendDOMNodeId: 101,
              frameId: 'main-frame'
            },
            {
              nodeId: 'group',
              ignored: false,
              role: { value: 'group' },
              name: { value: 'Payment' },
              frameId: 'main-frame'
            },
            {
              nodeId: 'main',
              ignored: false,
              role: { value: 'main' },
              frameId: 'main-frame'
            },
            {
              nodeId: 'document',
              ignored: false,
              role: { value: 'RootWebArea' },
              name: { value: 'Checkout' },
              frameId: 'main-frame'
            }
          ]
        }
      }
      if (method === 'Accessibility.getChildAXNodes' && params?.id === 'selected') {
        return {
          nodes: [
            {
              nodeId: 'ignored',
              ignored: true,
              role: { value: 'none' },
              childIds: ['text'],
              frameId: 'main-frame'
            }
          ]
        }
      }
      if (method === 'Accessibility.getChildAXNodes' && params?.id === 'ignored') {
        return {
          nodes: [
            {
              nodeId: 'text',
              ignored: false,
              role: { value: 'StaticText' },
              name: { value: 'Pay now' },
              childIds: [],
              frameId: 'main-frame'
            }
          ]
        }
      }
      return {}
    })
    const guest = createContents(7, host, { sendCommand })
    guestById.set(7, guest)
    getWindow.mockReturnValue({ webContents: host })
    service.replaceAnnotations(
      {
        webviewId: 7,
        navigationRevision: 0,
        target: { id: 'mini-app:demo', label: 'Demo' },
        annotations: [shadowAnnotation]
      },
      'owner'
    )

    const [resolved] = await resolveAnnotationsWithAccessibility(service, 'mini-app:demo')
    const context = resolved.annotations[0].accessibility

    expect(context).toMatchObject({
      status: 'available',
      truncated: false,
      path: [{ role: 'RootWebArea', name: 'Checkout' }, { role: 'main' }, { role: 'group', name: 'Payment' }],
      tree: {
        role: 'button',
        name: 'Computed submit',
        states: [{ name: 'disabled', value: true }],
        children: [{ role: 'StaticText', name: 'Pay now' }]
      }
    })
    expect(JSON.stringify(context)).not.toContain('SECRET_VALUE')
    expect(JSON.stringify(context)).not.toContain('valuetext')
    expect(JSON.stringify(context)).not.toContain('payment-panel')
    expect(sendCommand).toHaveBeenCalledWith(
      'Runtime.evaluate',
      expect.objectContaining({
        expression: expect.stringContaining('["#host","[data-testid=\\"submit\\"]"]')
      })
    )
    expect(guest.debugger.sendCommand).toHaveBeenCalledWith('Page.getFrameTree', undefined)
    expect(guest.debugger.sendCommand).toHaveBeenCalledWith('Page.createIsolatedWorld', {
      frameId: 'main-frame',
      worldName: 'cherry-webview-annotation-accessibility',
      grantUniveralAccess: false
    })
    expect(guest.debugger.sendCommand).toHaveBeenCalledWith(
      'Runtime.evaluate',
      expect.objectContaining({ contextId: 73 })
    )
    expect(sendCommand).toHaveBeenCalledWith('Accessibility.enable', undefined)
    expect(sendCommand).toHaveBeenCalledWith('Accessibility.disable', undefined)
    expect(sendCommand).toHaveBeenCalledWith('Runtime.disable', undefined)
    expect(sendCommand).toHaveBeenCalledWith('Runtime.releaseObjectGroup', {
      objectGroup: `webview-annotation:${annotation.id}`
    })
    expect(guest.debugger.attach).toHaveBeenCalledWith('1.3')
    expect(guest.debugger.detach).toHaveBeenCalledOnce()
  })

  it('does not descend into value-bearing controls whose AX text descendants can mirror form values', async () => {
    const host = {}
    const formAnnotation: WebviewAnnotation = {
      ...annotation,
      element: { ...annotation.element, selector: '#payment-form', tagName: 'form' }
    }
    const sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'selected-form' } }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 111 } }
      if (method === 'Accessibility.getAXNodeAndAncestors') {
        return {
          nodes: [
            {
              nodeId: 'form',
              ignored: false,
              role: { value: 'form' },
              name: { value: 'Payment form' },
              childIds: ['textbox'],
              backendDOMNodeId: 111,
              frameId: 'main-frame'
            }
          ]
        }
      }
      if (method === 'Accessibility.getChildAXNodes' && params?.id === 'form') {
        return {
          nodes: [
            {
              nodeId: 'textbox',
              ignored: false,
              role: { value: 'textbox' },
              name: { value: 'Email address' },
              childIds: ['value-text'],
              frameId: 'main-frame'
            }
          ]
        }
      }
      if (method === 'Accessibility.getChildAXNodes' && params?.id === 'textbox') {
        return {
          nodes: [
            {
              nodeId: 'value-text',
              ignored: false,
              role: { value: 'StaticText' },
              name: { value: 'SECRET_FORM_VALUE' },
              childIds: [],
              frameId: 'main-frame'
            }
          ]
        }
      }
      return {}
    })
    const guest = createContents(7, host, { sendCommand })
    guestById.set(7, guest)
    getWindow.mockReturnValue({ webContents: host })
    service.replaceAnnotations(
      {
        webviewId: 7,
        navigationRevision: 0,
        target: { id: 'mini-app:demo', label: 'Demo' },
        annotations: [formAnnotation]
      },
      'owner'
    )

    const [resolved] = await resolveAnnotationsWithAccessibility(service)
    const context = resolved.annotations[0].accessibility

    expect(context.tree).toMatchObject({
      role: 'form',
      children: [{ role: 'textbox', name: 'Email address', children: [] }]
    })
    expect(context.truncated).toBe(true)
    expect(JSON.stringify(context)).not.toContain('SECRET_FORM_VALUE')
    expect(sendCommand).not.toHaveBeenCalledWith(
      'Accessibility.getChildAXNodes',
      expect.objectContaining({ id: 'textbox' })
    )
  })

  it('falls back without attaching when DevTools or another debugger owns the guest', async () => {
    const host = {}
    const guest = createContents(7, host, { devToolsOpened: true })
    guestById.set(7, guest)
    getWindow.mockReturnValue({ webContents: host })
    service.replaceAnnotations(
      {
        webviewId: 7,
        navigationRevision: 0,
        target: { id: 'mini-app:demo', label: 'Demo' },
        annotations: [annotation]
      },
      'owner'
    )

    const [resolved] = await resolveAnnotationsWithAccessibility(service)

    expect(resolved.annotations[0].accessibility).toEqual({
      status: 'debugger_unavailable',
      path: [],
      tree: null,
      truncated: false
    })
    expect(guest.debugger.attach).not.toHaveBeenCalled()
  })

  it('falls back when debugger attachment fails without disturbing another session', async () => {
    const host = {}
    const guest = createContents(7, host)
    guest.debugger.attach.mockImplementation(() => {
      throw new Error('Another debugger is already attached')
    })
    guestById.set(7, guest)
    getWindow.mockReturnValue({ webContents: host })
    service.replaceAnnotations(
      {
        webviewId: 7,
        navigationRevision: 0,
        target: { id: 'mini-app:demo', label: 'Demo' },
        annotations: [annotation]
      },
      'owner'
    )

    const [resolved] = await resolveAnnotationsWithAccessibility(service)

    expect(resolved.annotations[0].accessibility.status).toBe('debugger_unavailable')
    expect(guest.debugger.sendCommand).not.toHaveBeenCalled()
    expect(guest.debugger.detach).not.toHaveBeenCalled()
  })

  it('distinguishes missing selectors from accessibility protocol failures', async () => {
    const host = {}
    const missingSelectorCommand = vi.fn(async (method: string) =>
      method === 'Runtime.evaluate' ? { result: { subtype: 'null' } } : {}
    )
    const missingSelectorGuest = createContents(7, host, { sendCommand: missingSelectorCommand })
    guestById.set(7, missingSelectorGuest)
    getWindow.mockReturnValue({ webContents: host })
    service.replaceAnnotations(
      {
        webviewId: 7,
        navigationRevision: 0,
        target: { id: 'mini-app:missing', label: 'Missing' },
        annotations: [annotation]
      },
      'owner'
    )

    const [missingSelectorResult] = await resolveAnnotationsWithAccessibility(service, 'mini-app:missing')

    expect(missingSelectorResult.annotations[0].accessibility.status).toBe('selector_not_found')
    expect(missingSelectorCommand).not.toHaveBeenCalledWith('DOM.describeNode', expect.anything())

    const protocolCommand = vi.fn(async (method: string) => {
      if (method === 'Runtime.evaluate') throw new Error('Protocol error')
      return {}
    })
    const protocolGuest = createContents(8, host, { sendCommand: protocolCommand })
    guestById.set(8, protocolGuest)
    service.replaceAnnotations(
      {
        webviewId: 8,
        navigationRevision: 0,
        target: { id: 'mini-app:protocol', label: 'Protocol' },
        annotations: [annotation]
      },
      'owner'
    )

    const [protocolResult] = await resolveAnnotationsWithAccessibility(service, 'mini-app:protocol')

    expect(protocolResult.annotations[0].accessibility.status).toBe('capture_failed')
    expect(protocolGuest.debugger.detach).toHaveBeenCalledOnce()
  })

  it('serializes concurrent accessibility reads for the same webview', async () => {
    const host = {}
    let resolveFirstEnable: ((value: unknown) => void) | undefined
    let runtimeEnableCalls = 0
    const sendCommand = vi.fn((method: string) => {
      if (method === 'Runtime.enable') {
        runtimeEnableCalls++
        if (runtimeEnableCalls === 1) {
          return new Promise((resolve) => {
            resolveFirstEnable = resolve
          })
        }
      }
      if (method === 'Runtime.evaluate') return Promise.resolve({ result: { objectId: 'selected-object' } })
      if (method === 'DOM.describeNode') return Promise.resolve({ node: { backendNodeId: 151 } })
      if (method === 'Accessibility.getAXNodeAndAncestors') {
        return Promise.resolve({
          nodes: [
            {
              nodeId: 'selected',
              ignored: false,
              role: { value: 'button' },
              childIds: [],
              backendDOMNodeId: 151
            }
          ]
        })
      }
      return Promise.resolve({})
    })
    const guest = createContents(7, host, { sendCommand })
    guestById.set(7, guest)
    getWindow.mockReturnValue({ webContents: host })
    service.replaceAnnotations(
      {
        webviewId: 7,
        navigationRevision: 0,
        target: { id: 'mini-app:demo', label: 'Demo' },
        annotations: [annotation]
      },
      'owner'
    )

    const firstRead = resolveAnnotationsWithAccessibility(service)
    await vi.waitFor(() => expect(guest.debugger.attach).toHaveBeenCalledOnce())
    const secondRead = resolveAnnotationsWithAccessibility(service)
    await Promise.resolve()
    expect(guest.debugger.attach).toHaveBeenCalledOnce()

    resolveFirstEnable?.({})
    await Promise.all([firstRead, secondRead])
    expect(guest.debugger.attach).toHaveBeenCalledTimes(2)
    expect(guest.debugger.detach).toHaveBeenCalledTimes(2)
  })

  it('does not descend into selected iframes or accessibility nodes from another frame', async () => {
    const host = {}
    const iframeAnnotation: WebviewAnnotation = {
      ...annotation,
      id: '123e4567-e89b-12d3-a456-426614174001',
      element: { ...annotation.element, selector: '#frame', tagName: 'iframe' }
    }
    const buttonAnnotation: WebviewAnnotation = {
      ...annotation,
      id: '123e4567-e89b-12d3-a456-426614174002',
      element: { ...annotation.element, selector: '#button' }
    }
    const sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Runtime.evaluate') {
        const expression = String(params?.expression)
        return { result: { objectId: expression.includes('#frame') ? 'iframe-object' : 'button-object' } }
      }
      if (method === 'DOM.describeNode') {
        return { node: { backendNodeId: params?.objectId === 'iframe-object' ? 201 : 202 } }
      }
      if (method === 'Accessibility.getAXNodeAndAncestors') {
        const backendNodeId = Number(params?.backendNodeId)
        return {
          nodes: [
            {
              nodeId: backendNodeId === 201 ? 'iframe' : 'button',
              ignored: false,
              role: { value: backendNodeId === 201 ? 'Iframe' : 'button' },
              name: { value: backendNodeId === 201 ? 'Remote content' : 'Continue' },
              childIds: ['same-frame-child', 'cross-frame-child'],
              backendDOMNodeId: backendNodeId,
              frameId: 'main-frame'
            }
          ]
        }
      }
      if (method === 'Accessibility.getChildAXNodes') {
        return {
          nodes: [
            {
              nodeId: 'same-frame-child',
              ignored: false,
              role: { value: 'StaticText' },
              name: { value: 'Same frame' },
              childIds: [],
              frameId: 'main-frame'
            },
            {
              nodeId: 'cross-frame-child',
              ignored: false,
              role: { value: 'document' },
              name: { value: 'Cross frame secret' },
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
    getWindow.mockReturnValue({ webContents: host })
    service.replaceAnnotations(
      {
        webviewId: 7,
        navigationRevision: 0,
        target: { id: 'mini-app:demo', label: 'Demo' },
        annotations: [iframeAnnotation, buttonAnnotation]
      },
      'owner'
    )

    const [resolved] = await resolveAnnotationsWithAccessibility(service)

    expect(resolved.annotations[0].accessibility.tree?.children).toEqual([])
    expect(resolved.annotations[1].accessibility.tree?.children).toEqual([
      expect.objectContaining({ name: 'Same frame' })
    ])
    expect(JSON.stringify(resolved)).not.toContain('Cross frame secret')
    expect(sendCommand.mock.calls.filter(([method]) => method === 'Accessibility.getChildAXNodes')).toHaveLength(1)
  })

  it('enforces the request node budget and marks later annotations without dropping them', async () => {
    const host = {}
    const annotations = Array.from({ length: 6 }, (_, index) => ({
      ...annotation,
      id: `123e4567-e89b-12d3-a456-42661417400${index}`
    }))
    const leafNodes = Array.from({ length: 100 }, (_, index) => ({
      nodeId: `leaf-${index}`,
      ignored: false,
      role: { value: 'StaticText' },
      name: { value: `Leaf ${index}` },
      childIds: [],
      frameId: 'main-frame'
    }))
    const sendCommand = vi.fn(async (method: string) => {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'selected-object' } }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 301 } }
      if (method === 'Accessibility.getAXNodeAndAncestors') {
        return {
          nodes: [
            {
              nodeId: 'selected',
              ignored: false,
              role: { value: 'group' },
              childIds: leafNodes.map((node) => node.nodeId),
              backendDOMNodeId: 301,
              frameId: 'main-frame'
            }
          ]
        }
      }
      if (method === 'Accessibility.getChildAXNodes') return { nodes: leafNodes }
      return {}
    })
    const guest = createContents(7, host, { sendCommand })
    guestById.set(7, guest)
    getWindow.mockReturnValue({ webContents: host })
    service.replaceAnnotations(
      { webviewId: 7, navigationRevision: 0, target: { id: 'mini-app:demo', label: 'Demo' }, annotations },
      'owner'
    )

    const [resolved] = await resolveAnnotationsWithAccessibility(service)

    expect(resolved.annotations.slice(0, 5).every((item) => item.accessibility.status === 'available')).toBe(true)
    expect(resolved.annotations.slice(0, 5).every((item) => item.accessibility.truncated)).toBe(true)
    expect(resolved.annotations[5].accessibility.status).toBe('budget_exceeded')
    expect(resolved.annotations).toHaveLength(6)
  })

  it('returns a timeout fallback and discards results invalidated during capture', async () => {
    vi.useFakeTimers()
    try {
      const host = {}
      const timeoutCommand = vi.fn((method: string) =>
        method === 'Runtime.enable' ? new Promise(() => undefined) : Promise.resolve({})
      )
      const timeoutGuest = createContents(7, host, { sendCommand: timeoutCommand })
      guestById.set(7, timeoutGuest)
      getWindow.mockReturnValue({ webContents: host })
      service.replaceAnnotations(
        {
          webviewId: 7,
          navigationRevision: 0,
          target: { id: 'mini-app:demo', label: 'Demo' },
          annotations: [annotation]
        },
        'owner'
      )

      const timeoutResult = resolveAnnotationsWithAccessibility(service)
      await vi.advanceTimersByTimeAsync(ACCESSIBILITY_CAPTURE_TIMEOUT_MS_FOR_TEST)
      const [resolved] = await timeoutResult
      expect(resolved.annotations[0].accessibility.status).toBe('timeout')
      expect(timeoutGuest.debugger.detach).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }

    service.clearAnnotations(7)
    const host = {}
    const sendCommand = vi.fn(async (method: string) => {
      if (method === 'Runtime.evaluate') {
        service.clearAnnotations(8)
        return { result: { objectId: 'selected-object' } }
      }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 401 } }
      if (method === 'Accessibility.getAXNodeAndAncestors') {
        return {
          nodes: [
            {
              nodeId: 'selected',
              ignored: false,
              role: { value: 'button' },
              childIds: [],
              backendDOMNodeId: 401
            }
          ]
        }
      }
      return {}
    })
    const staleGuest = createContents(8, host, { sendCommand })
    guestById.set(8, staleGuest)
    getWindow.mockReturnValue({ webContents: host })
    service.replaceAnnotations(
      {
        webviewId: 8,
        navigationRevision: 0,
        target: { id: 'mini-app:stale', label: 'Stale' },
        annotations: [annotation]
      },
      'owner'
    )

    await expect(resolveAnnotationsWithAccessibility(service)).resolves.toEqual([])
  })

  it('validates ownership before exporting resolved Markdown', async () => {
    const host = {}
    const guest = createContents(7, host, { devToolsOpened: true })
    guestById.set(7, guest)
    getWindow.mockImplementation((id: string) => (id === 'owner' ? { webContents: host } : undefined))
    service.replaceAnnotations(
      {
        webviewId: 7,
        navigationRevision: 0,
        target: { id: 'mini-app:demo', label: 'Demo' },
        annotations: [annotation]
      },
      'owner'
    )

    await expect(service.getAnnotationsMarkdown(7, 'other')).rejects.toThrow('The caller does not own this webview')
    const markdown = await service.getAnnotationsMarkdown(7, 'owner')
    expect(markdown).toContain('Fix this')
    expect(markdown).toContain('Accessibility status: `debugger_unavailable`')
    expect(markdown).toContain('untrusted page data')
  })
})
