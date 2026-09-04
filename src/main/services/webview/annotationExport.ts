import { loggerService } from '@logger'
import {
  WEBVIEW_ANNOTATION_LIMITS,
  WEBVIEW_SHADOW_SELECTOR_SEPARATOR,
  type WebviewAnnotation,
  type WebviewAnnotationTarget
} from '@shared/types/webviewAnnotation'

import { formatWebviewAnnotations, sanitizeWebviewAnnotationUrl } from './annotationMarkdown'
import type {
  AccessibilityCaptureBudget,
  AccessibilityContext,
  AccessibilityState,
  AccessibilityStatus,
  AccessibleNode,
  AccessibleNodeSummary,
  AnnotationDocument,
  CdpAccessibilityNode,
  CdpAccessibilityProperty,
  CdpPageCreateIsolatedWorldResult,
  CdpPageGetFrameTreeResult,
  CdpRuntimeEvaluateResult,
  ResolvedAnnotation,
  ResolvedAnnotationDocument
} from './annotationTypes'

const logger = loggerService.withContext('annotationExport')
const ACCESSIBILITY_CAPTURE_TIMEOUT_MS = 5_000
const ACCESSIBILITY_WORLD_NAME = 'cherry-webview-annotation-accessibility'

class AccessibilityCaptureTimeout extends Error {}

const ACCESSIBILITY_STATE_NAMES = new Set<AccessibilityState['name']>([
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
  status: AccessibilityStatus,
  options: Partial<Pick<AccessibilityContext, 'path' | 'tree' | 'truncated'>> = {}
): AccessibilityContext => ({
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

const normalizeAccessibilityState = (property: CdpAccessibilityProperty): AccessibilityState | null => {
  if (!ACCESSIBILITY_STATE_NAMES.has(property.name as AccessibilityState['name'])) return null
  const value = property.value?.value
  if (typeof value !== 'boolean' && typeof value !== 'string') return null
  return {
    name: property.name as AccessibilityState['name'],
    value: typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 64) : value
  }
}

const normalizeAccessibilityNode = (node: CdpAccessibilityNode): AccessibleNodeSummary => ({
  role:
    normalizeAccessibilityText(node.role?.value)?.slice(0, WEBVIEW_ANNOTATION_LIMITS.role) ??
    (node.ignored ? 'ignored' : 'unknown'),
  name: normalizeAccessibilityText(node.name?.value),
  description: normalizeAccessibilityText(node.description?.value),
  states: (node.properties ?? [])
    .map(normalizeAccessibilityState)
    .filter((state): state is AccessibilityState => state !== null)
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

async function sendDebuggerCommand<T>(
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

async function sendDebuggerCleanupCommand(
  debuggerSession: Electron.Debugger,
  method: string,
  params: Record<string, unknown> | undefined,
  deadline: number
): Promise<void> {
  if (!debuggerSession.isAttached() || Date.now() >= deadline) return
  await sendDebuggerCommand(debuggerSession, method, params, deadline).catch(() => undefined)
}

async function captureAnnotationAccessibility(
  debuggerSession: Electron.Debugger,
  executionContextId: number,
  annotation: WebviewAnnotation,
  budget: AccessibilityCaptureBudget,
  deadline: number
): Promise<AccessibilityContext> {
  if (budget.remaining <= 0) return createAccessibilityContext('budget_exceeded')
  if (Date.now() >= deadline) return createAccessibilityContext('timeout')

  const objectGroup = `webview-annotation:${annotation.id}`
  try {
    const evaluated = await sendDebuggerCommand<CdpRuntimeEvaluateResult>(
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

    const described = await sendDebuggerCommand<{ node?: { backendNodeId?: number } }>(
      debuggerSession,
      'DOM.describeNode',
      { objectId },
      deadline
    )
    const backendNodeId = described.node?.backendNodeId
    if (!backendNodeId) throw new Error('Selected element has no backend DOM node')

    const ancestorsResult = await sendDebuggerCommand<{ nodes?: CdpAccessibilityNode[] }>(
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

    const walk = async (node: CdpAccessibilityNode, depth: number, isRoot: boolean): Promise<AccessibleNode[]> => {
      if (walkState.visited >= WEBVIEW_ANNOTATION_LIMITS.accessibilityNodes || budget.remaining <= 0) {
        walkState.truncated = true
        return []
      }

      walkState.visited++
      budget.remaining--
      const children: AccessibleNode[] = []
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
        const childResult = await sendDebuggerCommand<{ nodes?: CdpAccessibilityNode[] }>(
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
    await sendDebuggerCleanupCommand(debuggerSession, 'Runtime.releaseObjectGroup', { objectGroup }, deadline)
  }
}

async function captureDocumentAccessibility(
  guest: Electron.WebContents,
  document: AnnotationDocument,
  budget: AccessibilityCaptureBudget,
  deadline: number
): Promise<ResolvedAnnotation[]> {
  const withStatus = (status: AccessibilityStatus) =>
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
      await sendDebuggerCommand(debuggerSession, 'Runtime.enable', undefined, deadline)
      await sendDebuggerCommand(debuggerSession, 'Accessibility.enable', undefined, deadline)

      const frameTreeResult = await sendDebuggerCommand<CdpPageGetFrameTreeResult>(
        debuggerSession,
        'Page.getFrameTree',
        undefined,
        deadline
      )
      const frameId = frameTreeResult.frameTree?.frame?.id
      if (!frameId) throw new Error('Webview main frame is unavailable')

      const isolatedWorld = await sendDebuggerCommand<CdpPageCreateIsolatedWorldResult>(
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

    const resolved: ResolvedAnnotation[] = []
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
          accessibility: await captureAnnotationAccessibility(
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
      await sendDebuggerCleanupCommand(debuggerSession, 'Accessibility.disable', undefined, deadline)
      await sendDebuggerCleanupCommand(debuggerSession, 'Runtime.disable', undefined, deadline)
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

interface ExportAnnotationDocumentInput {
  guest: Electron.WebContents
  target: WebviewAnnotationTarget
  annotations: WebviewAnnotation[]
}

export async function exportAnnotationDocument({
  guest,
  target,
  annotations
}: ExportAnnotationDocumentInput): Promise<string> {
  if (new Set(annotations.map((annotation) => annotation.id)).size !== annotations.length) {
    throw new Error('Annotation ids must be unique')
  }

  const document: AnnotationDocument = {
    target,
    page: {
      title: guest.getTitle().replace(/\s+/g, ' ').trim().slice(0, WEBVIEW_ANNOTATION_LIMITS.pageTitle),
      url: sanitizeWebviewAnnotationUrl(guest.getURL()).slice(0, WEBVIEW_ANNOTATION_LIMITS.pageUrl)
    },
    annotations
  }
  const resolvedAnnotations = await captureDocumentAccessibility(
    guest,
    document,
    { remaining: WEBVIEW_ANNOTATION_LIMITS.accessibilityRequestNodes },
    Date.now() + ACCESSIBILITY_CAPTURE_TIMEOUT_MS
  )
  const copyDocument: ResolvedAnnotationDocument = {
    ...document,
    annotations: resolvedAnnotations.map((annotation) => ({
      ...annotation,
      accessibility: { ...annotation.accessibility }
    }))
  }
  let markdown = formatWebviewAnnotations(copyDocument, { includeSafetyNotice: true }).text

  for (
    let annotationIndex = copyDocument.annotations.length - 1;
    markdown.length > WEBVIEW_ANNOTATION_LIMITS.exportMarkdown && annotationIndex >= 0;
    annotationIndex--
  ) {
    const annotation = copyDocument.annotations[annotationIndex]
    if (annotation.accessibility.status !== 'available') continue
    annotation.accessibility = createAccessibilityContext('budget_exceeded')
    markdown = formatWebviewAnnotations(copyDocument, { includeSafetyNotice: true }).text
  }

  return formatWebviewAnnotations(copyDocument, {
    includeSafetyNotice: true,
    maxChars: WEBVIEW_ANNOTATION_LIMITS.exportMarkdown
  }).text
}
