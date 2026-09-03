import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getAppLanguage, t } from '@main/i18n'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { webviewErrorCodes } from '@shared/ipc/errors/webview'
import type { WindowId } from '@shared/ipc/types'
import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  WEBVIEW_ANNOTATION_LIMITS,
  WEBVIEW_SHADOW_SELECTOR_SEPARATOR,
  type WebviewAccessibilityContext,
  type WebviewAccessibilityState,
  type WebviewAccessibilityStatus,
  type WebviewAccessibleNode,
  type WebviewAccessibleNodeSummary,
  type WebviewAnnotation,
  type WebviewAnnotationDocument,
  type WebviewAnnotationHostCommand,
  type WebviewAnnotationTarget,
  type WebviewResolvedAnnotation,
  type WebviewResolvedAnnotationDocument
} from '@shared/types/webviewAnnotation'
import { app, dialog, session, shell, webContents } from 'electron'
import { existsSync, promises as fs } from 'fs'

import { isSafeExternalUrl } from '../utils/externalUrlSafety'
import { formatWebviewAnnotations, sanitizeWebviewAnnotationUrl } from '../utils/webviewAnnotations'

const logger = loggerService.withContext('WebviewService')
/** The one session site mini apps share; every other partition belongs to a policy this service must not touch. */
const WEBVIEW_PARTITION = 'persist:webview'
const ANNOTATION_CACHE_KEY = 'webview.annotations'
const ACCESSIBILITY_CAPTURE_TIMEOUT_MS = 5_000
const ACCESSIBILITY_WORLD_NAME = 'cherry-webview-annotation-accessibility'

type AnnotationRegistry = Record<string, WebviewAnnotationDocument>
type AccessibilityCaptureQueue = Promise<void>

interface ReplaceAnnotationsInput {
  webviewId: number
  navigationRevision: number
  target: WebviewAnnotationTarget
  annotations: WebviewAnnotation[]
}

interface AccessibilityCaptureBudget {
  remaining: number
}

interface CdpValue {
  value?: unknown
}

interface CdpAccessibilityProperty {
  name: string
  value?: CdpValue
}

interface CdpAccessibilityNode {
  nodeId: string
  ignored: boolean
  role?: CdpValue
  name?: CdpValue
  description?: CdpValue
  properties?: CdpAccessibilityProperty[]
  parentId?: string
  childIds?: string[]
  backendDOMNodeId?: number
  frameId?: string
}

interface CdpRuntimeEvaluateResult {
  result?: {
    objectId?: string
    subtype?: string
  }
  exceptionDetails?: unknown
}

interface CdpPageGetFrameTreeResult {
  frameTree?: {
    frame?: {
      id?: string
    }
  }
}

interface CdpPageCreateIsolatedWorldResult {
  executionContextId?: number
}

class AccessibilityCaptureTimeout extends Error {}

const ACCESSIBILITY_STATE_NAMES = new Set<WebviewAccessibilityState['name']>([
  'disabled',
  'expanded',
  'checked',
  'pressed',
  'selected',
  'required',
  'invalid',
  'readonly'
])

const FORM_CONTROL_TAG_NAMES = new Set(['input', 'option', 'select', 'textarea'])
const VALUE_BEARING_ACCESSIBILITY_ROLES = new Set(['combobox', 'searchbox', 'slider', 'spinbutton', 'textbox'])

const createAccessibilityContext = (
  status: WebviewAccessibilityStatus,
  options: Partial<Pick<WebviewAccessibilityContext, 'path' | 'tree' | 'truncated'>> = {}
): WebviewAccessibilityContext => ({
  status,
  path: options.path ?? [],
  tree: options.tree ?? null,
  truncated: options.truncated ?? false
})

const normalizeAccessibilityText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, WEBVIEW_ANNOTATION_LIMITS.accessibilityText) : null
}

const normalizeAccessibilityState = (property: CdpAccessibilityProperty): WebviewAccessibilityState | null => {
  if (!ACCESSIBILITY_STATE_NAMES.has(property.name as WebviewAccessibilityState['name'])) return null
  const value = property.value?.value
  if (typeof value !== 'boolean' && typeof value !== 'string') return null
  return {
    name: property.name as WebviewAccessibilityState['name'],
    value: typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 64) : value
  }
}

const normalizeAccessibilityNode = (node: CdpAccessibilityNode): WebviewAccessibleNodeSummary => ({
  role:
    normalizeAccessibilityText(node.role?.value)?.slice(0, WEBVIEW_ANNOTATION_LIMITS.role) ??
    (node.ignored ? 'ignored' : 'unknown'),
  name: normalizeAccessibilityText(node.name?.value),
  description: normalizeAccessibilityText(node.description?.value),
  states: (node.properties ?? [])
    .map(normalizeAccessibilityState)
    .filter((state): state is WebviewAccessibilityState => state !== null)
    .slice(0, WEBVIEW_ANNOTATION_LIMITS.accessibilityStates)
})

const buildElementResolverExpression = (selector: string) => {
  const segments = selector.split(WEBVIEW_SHADOW_SELECTOR_SEPARATOR)
  return `(() => {
    const segments = ${JSON.stringify(segments)};
    let root = document;
    let current = null;
    for (let index = 0; index < segments.length; index++) {
      try {
        current = root.querySelector(segments[index]);
      } catch {
        return null;
      }
      if (!current) return null;
      if (index < segments.length - 1) {
        if (!current.shadowRoot) return null;
        root = current.shadowRoot;
      }
    }
    return current;
  })()`
}

/**
 * init the useragent of the webview session
 * remove the CherryStudio and Electron from the useragent
 */
export function initSessionUserAgent() {
  const wvSession = session.fromPartition(WEBVIEW_PARTITION)
  const originUA = wvSession.getUserAgent()
  const newUA = originUA.replace(/CherryStudio\/\S+\s/, '').replace(/Electron\/\S+\s/, '')

  wvSession.setUserAgent(newUA)
  wvSession.webRequest.onBeforeSendHeaders((details, cb) => {
    const language = application.get('PreferenceService').get('app.language')
    const headers = {
      ...details.requestHeaders,
      'User-Agent': details.url.includes('google.com') ? originUA : newUA,
      'Accept-Language': `${language}, en;q=0.9, *;q=0.5`
    }
    cb({ requestHeaders: headers })
  })
}

/**
 * WebviewService handles the behavior of links opened from webview elements
 * It controls whether links should be opened within the application or in an external browser.
 *
 * Site webviews only. A local mini app guest (`persist:miniapp:*`) carries its own deny-all
 * popup policy, and `setWindowOpenHandler` replaces whatever was installed before it.
 */
export function setOpenLinkExternal(webviewId: number, isExternal: boolean) {
  const webview = webContents.fromId(webviewId)
  if (!webview) return
  if (webview.session !== session.fromPartition(WEBVIEW_PARTITION)) {
    logger.warn('Refused to change the popup policy of a webview outside the site partition', { webviewId })
    return
  }

  webview.setWindowOpenHandler(({ url }) => {
    if (isExternal) {
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url)
      } else {
        logger.warn(`Blocked shell.openExternal for untrusted URL scheme: ${url}`)
      }
      return { action: 'deny' }
    } else {
      if (url.startsWith('http:') || url.startsWith('https:')) {
        return { action: 'allow' }
      }
      logger.warn(`Blocked in-app popup for untrusted URL scheme: ${url}`)
      return { action: 'deny' }
    }
  })
}

@Injectable('WebviewService')
@ServicePhase(Phase.WhenReady)
export class WebviewService extends BaseService {
  private readonly preloadAttachedContents = new WeakSet<Electron.WebContents>()
  private readonly initializedWebviews = new WeakSet<Electron.WebContents>()
  private readonly accessibilityCaptureQueues = new Map<number, AccessibilityCaptureQueue>()
  private readonly annotationNavigationRevisions = new WeakMap<Electron.WebContents, number>()

  protected async onInit() {
    this.initSessionUserAgent()
    this.initWebviews()
  }

  protected async onStop() {
    application.get('CacheService').delete(ANNOTATION_CACHE_KEY)
    this.accessibilityCaptureQueues.clear()
  }

  /**
   * Initialize the useragent of the webview session.
   * Removes CherryStudio and Electron from the useragent.
   */
  private initSessionUserAgent() {
    const wvSession = session.fromPartition(WEBVIEW_PARTITION)
    const originUA = wvSession.getUserAgent()
    const newUA = originUA.replace(/CherryStudio\/\S+\s/, '').replace(/Electron\/\S+\s/, '')

    wvSession.setUserAgent(newUA)
    wvSession.webRequest.onBeforeSendHeaders((details, cb) => {
      const language = getAppLanguage()
      const headers = {
        ...details.requestHeaders,
        'User-Agent': details.url.includes('google.com') ? originUA : newUA,
        'Accept-Language': `${language}, en;q=0.9, *;q=0.5`
      }
      cb({ requestHeaders: headers })
    })
    this.registerDisposable(() => wvSession.webRequest.onBeforeSendHeaders(null))
  }

  private initWebviews() {
    webContents.getAllWebContents().forEach((contents) => {
      if (contents.isDestroyed()) return
      this.attachWebviewPreload(contents)
      this.initializeWebview(contents)
    })

    const handler = (_: Electron.Event, contents: Electron.WebContents) => {
      this.attachWebviewPreload(contents)
      this.initializeWebview(contents)
    }
    app.on('web-contents-created', handler)
    this.registerDisposable(() => app.removeListener('web-contents-created', handler))
  }

  private attachWebviewPreload(contents: Electron.WebContents) {
    if (this.preloadAttachedContents.has(contents)) return
    this.preloadAttachedContents.add(contents)

    const preloadPath = application.getPath('feature.webview.preload_file')
    if (!existsSync(preloadPath)) {
      logger.error(`Webview preload is missing, annotations and host shortcuts will not work: ${preloadPath}`)
      this.preloadAttachedContents.delete(contents)
      return
    }

    const handler = (
      _event: Electron.Event,
      webPreferences: Electron.WebPreferences,
      params: { partition?: string }
    ) => {
      // Local mini apps own a separate capability bridge and sandbox policy. Electron has
      // one preload slot, so writing here would silently replace that bridge.
      if (params.partition !== WEBVIEW_PARTITION) return
      webPreferences.preload = preloadPath
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
    }

    contents.on('will-attach-webview', handler)
    const cleanup = () => {
      contents.removeListener('will-attach-webview', handler)
      contents.removeListener('destroyed', cleanup)
      this.preloadAttachedContents.delete(contents)
    }
    contents.once('destroyed', cleanup)
    this.registerDisposable(cleanup)
  }

  private initializeWebview(contents: Electron.WebContents) {
    if (
      contents.getType?.() !== 'webview' ||
      contents.session !== session.fromPartition(WEBVIEW_PARTITION) ||
      this.initializedWebviews.has(contents)
    ) {
      return
    }
    this.initializedWebviews.add(contents)
    if (!this.annotationNavigationRevisions.has(contents)) {
      this.annotationNavigationRevisions.set(contents, 0)
    }

    const clearAnnotations = () => this.clearAnnotations(contents.id)
    const sendNavigationReset = () => {
      if (contents.isDestroyed()) return
      const command: WebviewAnnotationHostCommand = {
        type: 'reset_for_navigation',
        navigationRevision: this.annotationNavigationRevisions.get(contents) ?? 0
      }
      try {
        contents.send(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, command)
      } catch (error) {
        logger.debug('Failed to reset webview annotations after navigation', { webviewId: contents.id, error })
      }
    }
    const invalidateAnnotations = (notifyGuest: boolean) => {
      const revision = (this.annotationNavigationRevisions.get(contents) ?? 0) + 1
      this.annotationNavigationRevisions.set(contents, revision)
      clearAnnotations()
      if (notifyGuest) sendNavigationReset()
    }
    const handleDestroyed = () => {
      clearAnnotations()
      this.accessibilityCaptureQueues.delete(contents.id)
      this.annotationNavigationRevisions.delete(contents)
      this.initializedWebviews.delete(contents)
    }
    const handleNavigation = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (details.isMainFrame) invalidateAnnotations(true)
    }
    const handleRenderProcessGone = () => invalidateAnnotations(false)

    contents.on('did-start-navigation', handleNavigation)
    contents.on('render-process-gone', handleRenderProcessGone)
    contents.on('dom-ready', sendNavigationReset)
    contents.once('destroyed', handleDestroyed)
    this.registerDisposable(() => {
      if (!contents.isDestroyed()) {
        contents.removeListener('did-start-navigation', handleNavigation)
        contents.removeListener('render-process-gone', handleRenderProcessGone)
        contents.removeListener('dom-ready', sendNavigationReset)
        contents.removeListener('destroyed', handleDestroyed)
      }
      this.initializedWebviews.delete(contents)
    })
  }

  private getAnnotationRegistry(): AnnotationRegistry {
    return application.get('CacheService').get<AnnotationRegistry>(ANNOTATION_CACHE_KEY) ?? {}
  }

  private setAnnotationRegistry(registry: AnnotationRegistry) {
    if (Object.keys(registry).length === 0) {
      application.get('CacheService').delete(ANNOTATION_CACHE_KEY)
    } else {
      application.get('CacheService').set(ANNOTATION_CACHE_KEY, registry)
    }
  }

  private requireOwnedWebview(webviewId: number, senderId: WindowId | null) {
    const hostWindow = senderId ? application.get('WindowManager').getWindow(senderId) : undefined
    const guest = webContents.fromId(webviewId)

    if (
      !hostWindow ||
      !guest ||
      guest.isDestroyed() ||
      guest.getType?.() !== 'webview' ||
      guest.session !== session.fromPartition(WEBVIEW_PARTITION) ||
      guest.hostWebContents !== hostWindow.webContents
    ) {
      throw new IpcError(webviewErrorCodes.NOT_OWNED, 'The caller does not own this webview')
    }

    return guest
  }

  replaceAnnotations(input: ReplaceAnnotationsInput, senderId: WindowId | null): void {
    const guest = this.requireOwnedWebview(input.webviewId, senderId)
    if (input.navigationRevision !== (this.annotationNavigationRevisions.get(guest) ?? 0)) return

    const registry = { ...this.getAnnotationRegistry() }
    const key = String(input.webviewId)

    if (input.annotations.length === 0) {
      delete registry[key]
      this.setAnnotationRegistry(registry)
      return
    }

    registry[key] = {
      webviewId: input.webviewId,
      target: input.target,
      page: {
        title: guest.getTitle().replace(/\s+/g, ' ').trim().slice(0, WEBVIEW_ANNOTATION_LIMITS.pageTitle),
        url: sanitizeWebviewAnnotationUrl(guest.getURL()).slice(0, WEBVIEW_ANNOTATION_LIMITS.pageUrl)
      },
      annotations: input.annotations,
      updatedAt: Math.max(Date.now(), (registry[key]?.updatedAt ?? 0) + 1)
    }
    this.setAnnotationRegistry(registry)
  }

  clearAnnotations(webviewId: number): void {
    const registry = { ...this.getAnnotationRegistry() }
    const key = String(webviewId)
    if (!(key in registry)) return
    delete registry[key]
    this.setAnnotationRegistry(registry)
  }

  private listAnnotations(): WebviewAnnotationDocument[] {
    const registry = { ...this.getAnnotationRegistry() }
    let changed = false

    for (const [key, document] of Object.entries(registry)) {
      const guest = webContents.fromId(document.webviewId)
      if (!guest || guest.isDestroyed() || guest.getType?.() !== 'webview') {
        delete registry[key]
        changed = true
      }
    }
    if (changed) this.setAnnotationRegistry(registry)

    return Object.values(registry).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private enqueueAccessibilityCapture<T>(webviewId: number, task: () => Promise<T>): Promise<T> {
    const previous = this.accessibilityCaptureQueues.get(webviewId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(task)
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.accessibilityCaptureQueues.set(webviewId, tail)
    return result.finally(() => {
      if (this.accessibilityCaptureQueues.get(webviewId) === tail) {
        this.accessibilityCaptureQueues.delete(webviewId)
      }
    })
  }

  private async sendDebuggerCommand<T>(
    debuggerSession: Electron.Debugger,
    method: string,
    params: Record<string, unknown> | undefined,
    deadline: number
  ): Promise<T> {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new AccessibilityCaptureTimeout('Accessibility capture timed out')

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      return (await Promise.race([
        debuggerSession.sendCommand(method, params),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new AccessibilityCaptureTimeout('Accessibility capture timed out')),
            remaining
          )
        })
      ])) as T
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  private async sendDebuggerCleanupCommand(
    debuggerSession: Electron.Debugger,
    method: string,
    params: Record<string, unknown> | undefined,
    deadline: number
  ): Promise<void> {
    if (!debuggerSession.isAttached() || Date.now() >= deadline) return
    await this.sendDebuggerCommand(debuggerSession, method, params, deadline).catch(() => undefined)
  }

  private async captureAnnotationAccessibility(
    debuggerSession: Electron.Debugger,
    executionContextId: number,
    annotation: WebviewAnnotation,
    budget: AccessibilityCaptureBudget,
    deadline: number
  ): Promise<WebviewAccessibilityContext> {
    if (budget.remaining <= 0) return createAccessibilityContext('budget_exceeded')
    if (Date.now() >= deadline) return createAccessibilityContext('timeout')

    const objectGroup = `webview-annotation:${annotation.id}`
    try {
      const evaluated = await this.sendDebuggerCommand<CdpRuntimeEvaluateResult>(
        debuggerSession,
        'Runtime.evaluate',
        {
          expression: buildElementResolverExpression(annotation.element.selector),
          contextId: executionContextId,
          objectGroup,
          returnByValue: false,
          silent: true
        },
        deadline
      )
      if (evaluated.exceptionDetails) throw new Error('Element selector evaluation failed')
      const objectId = evaluated.result?.objectId
      if (!objectId || evaluated.result?.subtype === 'null') {
        return createAccessibilityContext('selector_not_found')
      }

      const described = await this.sendDebuggerCommand<{ node?: { backendNodeId?: number } }>(
        debuggerSession,
        'DOM.describeNode',
        { objectId },
        deadline
      )
      const backendNodeId = described.node?.backendNodeId
      if (!backendNodeId) throw new Error('Selected element has no backend DOM node')

      const ancestorsResult = await this.sendDebuggerCommand<{ nodes?: CdpAccessibilityNode[] }>(
        debuggerSession,
        'Accessibility.getAXNodeAndAncestors',
        { backendNodeId },
        deadline
      )
      const ancestorNodes = ancestorsResult.nodes ?? []
      const selectedNode = ancestorNodes.find((node) => node.backendDOMNodeId === backendNodeId) ?? ancestorNodes[0]
      if (!selectedNode) throw new Error('Selected element has no accessibility node')

      const orderedAncestors = ancestorNodes
        .filter((node) => node.nodeId !== selectedNode.nodeId && !node.ignored)
        .reverse()
      let pathTruncated = orderedAncestors.length > WEBVIEW_ANNOTATION_LIMITS.accessibilityPath
      const limitedAncestors =
        orderedAncestors.length <= WEBVIEW_ANNOTATION_LIMITS.accessibilityPath
          ? orderedAncestors
          : [orderedAncestors[0], ...orderedAncestors.slice(-(WEBVIEW_ANNOTATION_LIMITS.accessibilityPath - 1))]
      const availablePathSlots = Math.max(0, Math.min(limitedAncestors.length, budget.remaining - 1))
      if (availablePathSlots < limitedAncestors.length) pathTruncated = true
      const path = limitedAncestors.slice(0, availablePathSlots).map(normalizeAccessibilityNode)
      budget.remaining -= path.length

      const walkState = { visited: 0, truncated: false }
      const selectedFrameId = selectedNode.frameId ?? ancestorNodes.find((node) => node.frameId)?.frameId
      const selectedIsIframe = annotation.element.tagName.toLowerCase() === 'iframe'
      const selectedIsFormControl = FORM_CONTROL_TAG_NAMES.has(annotation.element.tagName.toLowerCase())

      const walk = async (
        node: CdpAccessibilityNode,
        depth: number,
        isRoot: boolean
      ): Promise<WebviewAccessibleNode[]> => {
        if (walkState.visited >= WEBVIEW_ANNOTATION_LIMITS.accessibilityNodes || budget.remaining <= 0) {
          walkState.truncated = true
          return []
        }

        walkState.visited++
        budget.remaining--
        const children: WebviewAccessibleNode[] = []
        const hasChildren = (node.childIds?.length ?? 0) > 0
        const atDepthLimit = depth >= WEBVIEW_ANNOTATION_LIMITS.accessibilityDepth
        const role = normalizeAccessibilityText(node.role?.value)?.toLowerCase()
        const mayExposeFormValue =
          (isRoot && selectedIsFormControl) ||
          (role ? VALUE_BEARING_ACCESSIBILITY_ROLES.has(role) : false) ||
          (node.properties ?? []).some((property) => property.name === 'editable' && property.value?.value !== false)
        const mayDescend = !(selectedIsIframe && isRoot) && !mayExposeFormValue && hasChildren && !atDepthLimit

        if ((atDepthLimit || mayExposeFormValue) && hasChildren) {
          walkState.truncated = true
        } else if (mayDescend) {
          const childResult = await this.sendDebuggerCommand<{ nodes?: CdpAccessibilityNode[] }>(
            debuggerSession,
            'Accessibility.getChildAXNodes',
            {
              id: node.nodeId,
              ...(node.frameId ? { frameId: node.frameId } : {})
            },
            deadline
          )
          for (const child of childResult.nodes ?? []) {
            if (selectedFrameId && child.frameId && child.frameId !== selectedFrameId) continue
            children.push(...(await walk(child, depth + 1, false)))
            if (walkState.visited >= WEBVIEW_ANNOTATION_LIMITS.accessibilityNodes || budget.remaining <= 0) {
              if ((childResult.nodes?.at(-1)?.nodeId ?? child.nodeId) !== child.nodeId) {
                walkState.truncated = true
              }
              break
            }
          }
        }

        if (node.ignored && !isRoot) return children
        return [{ ...normalizeAccessibilityNode(node), children }]
      }

      const tree = (await walk(selectedNode, 1, true))[0] ?? null
      if (!tree) return createAccessibilityContext('budget_exceeded', { truncated: true })
      return createAccessibilityContext('available', {
        path,
        tree,
        truncated: pathTruncated || walkState.truncated
      })
    } finally {
      await this.sendDebuggerCleanupCommand(debuggerSession, 'Runtime.releaseObjectGroup', { objectGroup }, deadline)
    }
  }

  private async captureDocumentAccessibility(
    guest: Electron.WebContents,
    document: WebviewAnnotationDocument,
    budget: AccessibilityCaptureBudget,
    deadline: number
  ): Promise<WebviewResolvedAnnotation[]> {
    const withStatus = (status: WebviewAccessibilityStatus) =>
      document.annotations.map((annotation) => ({
        ...annotation,
        accessibility: createAccessibilityContext(status)
      }))

    if (Date.now() >= deadline) return withStatus('timeout')
    if (budget.remaining <= 0) return withStatus('budget_exceeded')
    if (guest.isDestroyed() || guest.isDevToolsOpened() || guest.debugger.isAttached()) {
      return withStatus('debugger_unavailable')
    }

    const debuggerSession = guest.debugger
    let attached = false
    try {
      try {
        debuggerSession.attach('1.3')
        attached = true
      } catch (error) {
        logger.debug('Webview accessibility debugger is unavailable', {
          webviewId: guest.id,
          error: error instanceof Error ? error.message : String(error)
        })
        return withStatus('debugger_unavailable')
      }

      let executionContextId: number
      try {
        await this.sendDebuggerCommand(debuggerSession, 'Runtime.enable', undefined, deadline)
        await this.sendDebuggerCommand(debuggerSession, 'Accessibility.enable', undefined, deadline)

        const frameTreeResult = await this.sendDebuggerCommand<CdpPageGetFrameTreeResult>(
          debuggerSession,
          'Page.getFrameTree',
          undefined,
          deadline
        )
        const frameId = frameTreeResult.frameTree?.frame?.id
        if (!frameId) throw new Error('Webview main frame is unavailable')

        const isolatedWorld = await this.sendDebuggerCommand<CdpPageCreateIsolatedWorldResult>(
          debuggerSession,
          'Page.createIsolatedWorld',
          {
            frameId,
            worldName: ACCESSIBILITY_WORLD_NAME,
            grantUniveralAccess: false
          },
          deadline
        )
        if (typeof isolatedWorld.executionContextId !== 'number') {
          throw new Error('Webview isolated world is unavailable')
        }
        executionContextId = isolatedWorld.executionContextId
      } catch (error) {
        const status = error instanceof AccessibilityCaptureTimeout ? 'timeout' : 'capture_failed'
        logger.debug('Failed to initialize webview accessibility capture', {
          webviewId: guest.id,
          status,
          error: error instanceof Error ? error.message : String(error)
        })
        return withStatus(status)
      }

      const resolved: WebviewResolvedAnnotation[] = []
      for (const annotation of document.annotations) {
        if (Date.now() >= deadline) {
          resolved.push({
            ...annotation,
            accessibility: createAccessibilityContext('timeout')
          })
          continue
        }
        if (budget.remaining <= 0) {
          resolved.push({
            ...annotation,
            accessibility: createAccessibilityContext('budget_exceeded')
          })
          continue
        }

        try {
          resolved.push({
            ...annotation,
            accessibility: await this.captureAnnotationAccessibility(
              debuggerSession,
              executionContextId,
              annotation,
              budget,
              deadline
            )
          })
        } catch (error) {
          const status = error instanceof AccessibilityCaptureTimeout ? 'timeout' : 'capture_failed'
          logger.debug('Failed to capture annotation accessibility context', {
            webviewId: guest.id,
            annotationId: annotation.id,
            status,
            error: error instanceof Error ? error.message : String(error)
          })
          resolved.push({
            ...annotation,
            accessibility: createAccessibilityContext(status)
          })
        }
      }
      return resolved
    } finally {
      if (attached) {
        await this.sendDebuggerCleanupCommand(debuggerSession, 'Accessibility.disable', undefined, deadline)
        await this.sendDebuggerCleanupCommand(debuggerSession, 'Runtime.disable', undefined, deadline)
        if (debuggerSession.isAttached()) {
          try {
            debuggerSession.detach()
          } catch (error) {
            logger.debug('Failed to detach webview accessibility debugger', {
              webviewId: guest.id,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }
      }
    }
  }

  private async resolveStoredAnnotationDocuments(
    documents: WebviewAnnotationDocument[]
  ): Promise<WebviewResolvedAnnotationDocument[]> {
    const budget: AccessibilityCaptureBudget = {
      remaining: WEBVIEW_ANNOTATION_LIMITS.accessibilityRequestNodes
    }
    const deadline = Date.now() + ACCESSIBILITY_CAPTURE_TIMEOUT_MS
    const resolvedDocuments: WebviewResolvedAnnotationDocument[] = []

    for (const document of documents) {
      const guest = webContents.fromId(document.webviewId)
      if (!guest || guest.isDestroyed() || guest.getType?.() !== 'webview') continue
      const urlBeforeCapture = guest.getURL()
      const annotations = await this.enqueueAccessibilityCapture(document.webviewId, () =>
        this.captureDocumentAccessibility(guest, document, budget, deadline)
      )
      const current = this.getAnnotationRegistry()[String(document.webviewId)]
      if (
        !current ||
        current.updatedAt !== document.updatedAt ||
        guest.isDestroyed() ||
        guest.getURL() !== urlBeforeCapture
      ) {
        continue
      }
      resolvedDocuments.push({ ...document, annotations })
    }

    return resolvedDocuments
  }

  async getAnnotationsMarkdown(webviewId: number, senderId: WindowId | null): Promise<string> {
    this.requireOwnedWebview(webviewId, senderId)
    const document = this.listAnnotations().find((item) => item.webviewId === webviewId)
    if (!document) return ''

    const resolvedDocuments = await this.resolveStoredAnnotationDocuments([document])
    if (resolvedDocuments.length === 0) return ''

    const copyDocuments = resolvedDocuments.map((resolvedDocument) => ({
      ...resolvedDocument,
      annotations: resolvedDocument.annotations.map((annotation) => ({
        ...annotation,
        accessibility: { ...annotation.accessibility }
      }))
    }))
    let markdown = formatWebviewAnnotations(copyDocuments, { includeSafetyNotice: true }).text

    for (
      let documentIndex = copyDocuments.length - 1;
      markdown.length > WEBVIEW_ANNOTATION_LIMITS.exportMarkdown;
      documentIndex--
    ) {
      const copyDocument = copyDocuments[documentIndex]
      if (!copyDocument) break
      for (let annotationIndex = copyDocument.annotations.length - 1; annotationIndex >= 0; annotationIndex--) {
        const annotation = copyDocument.annotations[annotationIndex]
        if (annotation.accessibility.status !== 'available') continue
        annotation.accessibility = createAccessibilityContext('budget_exceeded')
        markdown = formatWebviewAnnotations(copyDocuments, { includeSafetyNotice: true }).text
        if (markdown.length <= WEBVIEW_ANNOTATION_LIMITS.exportMarkdown) break
      }
    }

    return markdown.slice(0, WEBVIEW_ANNOTATION_LIMITS.exportMarkdown)
  }

  /**
   * Print webview content to PDF.
   */
  async printWebviewToPDF(webviewId: number): Promise<string | null> {
    const webview = webContents.fromId(webviewId)
    if (!webview) {
      throw new Error('Webview not found')
    }

    const pageTitle = await webview.executeJavaScript('document.title || "webpage"').catch(() => 'webpage')
    const sanitizedTitle = pageTitle.replace(/[<>:"/\\|?*]/g, '-').substring(0, 100)
    const defaultFilename = sanitizedTitle ? `${sanitizedTitle}.pdf` : `webpage-${Date.now()}.pdf`

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: t('dialog.save_as_pdf'),
      defaultPath: defaultFilename,
      filters: [{ name: t('dialog.pdf_files'), extensions: ['pdf'] }]
    })

    if (canceled || !filePath) {
      return null
    }

    const pdfData = await webview.printToPDF({
      margins: {
        marginType: 'default'
      },
      printBackground: true,
      landscape: false,
      pageSize: 'A4',
      preferCSSPageSize: true
    })

    await fs.writeFile(filePath, pdfData)

    return filePath
  }

  /**
   * Save webview content as HTML.
   */
  async saveWebviewAsHTML(webviewId: number): Promise<string | null> {
    const webview = webContents.fromId(webviewId)
    if (!webview) {
      throw new Error('Webview not found')
    }

    const pageTitle = await webview.executeJavaScript('document.title || "webpage"').catch(() => 'webpage')
    const sanitizedTitle = pageTitle.replace(/[<>:"/\\|?*]/g, '-').substring(0, 100)
    const defaultFilename = sanitizedTitle ? `${sanitizedTitle}.html` : `webpage-${Date.now()}.html`

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: t('dialog.save_as_html'),
      defaultPath: defaultFilename,
      filters: [
        { name: t('dialog.html_files'), extensions: ['html', 'htm'] },
        { name: t('dialog.all_files'), extensions: ['*'] }
      ]
    })

    if (canceled || !filePath) {
      return null
    }

    const html = await webview.executeJavaScript(`
      (() => {
        try {
          // Build complete DOCTYPE string if present
          let doctype = '';
          if (document.doctype) {
            const dt = document.doctype;
            doctype = '<!DOCTYPE ' + (dt.name || 'html');

            // Add PUBLIC identifier if publicId is present
            if (dt.publicId) {
              // Escape single quotes in publicId
              const escapedPublicId = String(dt.publicId).replace(/'/g, "\\\\'");
              doctype += " PUBLIC '" + escapedPublicId + "'";

              // Add systemId if present (required when publicId is present)
              if (dt.systemId) {
                const escapedSystemId = String(dt.systemId).replace(/'/g, "\\\\'");
                doctype += " '" + escapedSystemId + "'";
              }
            } else if (dt.systemId) {
              // SYSTEM identifier (without PUBLIC)
              const escapedSystemId = String(dt.systemId).replace(/'/g, "\\\\'");
              doctype += " SYSTEM '" + escapedSystemId + "'";
            }

            doctype += '>';
          }
          return doctype + (document.documentElement?.outerHTML || '');
        } catch (error) {
          // Fallback: just return the HTML without DOCTYPE if there's an error
          return document.documentElement?.outerHTML || '';
        }
      })()
    `)

    await fs.writeFile(filePath, html, 'utf-8')

    return filePath
  }
}
