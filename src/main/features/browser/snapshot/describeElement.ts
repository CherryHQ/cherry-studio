import {
  WEBVIEW_ANNOTATION_LIMITS,
  WEBVIEW_SHADOW_SELECTOR_SEPARATOR,
  type WebviewAnnotation
} from '@shared/types/webviewAnnotation'

import type { GuestSession } from '../session/GuestSession'
import type {
  AccessibilityCaptureBudget,
  AccessibilityContext,
  AccessibilityState,
  AccessibilityStatus,
  AccessibleNode,
  AccessibleNodeSummary,
  CdpAccessibilityNode,
  CdpAccessibilityProperty,
  CdpPageCreateIsolatedWorldResult,
  CdpPageGetFrameTreeResult,
  CdpRuntimeEvaluateResult
} from './accessibilityTypes'

export const ANNOTATION_EXPORT_LIMITS = {
  accessibilityDepth: 5,
  accessibilityNodes: 80,
  accessibilityPath: 12,
  accessibilityRequestNodes: 400,
  accessibilityStates: 8,
  accessibilityText: 240,
  pageTitle: 240,
  pageUrl: 2_048
} as const

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

export const createAccessibilityContext = (
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
  return normalized ? normalized.slice(0, ANNOTATION_EXPORT_LIMITS.accessibilityText) : null
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
    .slice(0, ANNOTATION_EXPORT_LIMITS.accessibilityStates)
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
  session: GuestSession,
  method: string,
  params: Record<string, unknown> | undefined,
  deadline: number,
  signal?: AbortSignal
): Promise<T> {
  return session.send<T>(method, params, { deadline, signal })
}

async function sendDebuggerCleanupCommand(
  debuggerSession: GuestSession,
  method: string,
  params: Record<string, unknown> | undefined,
  deadline: number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted || !debuggerSession.isAvailable() || Date.now() >= deadline) return
  await sendDebuggerCommand(debuggerSession, method, params, deadline).catch(() => undefined)
}

export async function describeElement(
  debuggerSession: GuestSession,
  annotation: WebviewAnnotation,
  budget: AccessibilityCaptureBudget,
  deadline: number,
  signal?: AbortSignal
): Promise<AccessibilityContext> {
  if (budget.remaining <= 0) return createAccessibilityContext('budget_exceeded')
  if (Date.now() >= deadline) return createAccessibilityContext('timeout')

  const frameTree = await sendDebuggerCommand<CdpPageGetFrameTreeResult>(
    debuggerSession,
    'Page.getFrameTree',
    undefined,
    deadline,
    signal
  )
  const frameId = frameTree.frameTree?.frame?.id
  if (!frameId) throw new Error('Webview main frame is unavailable')
  const world = await sendDebuggerCommand<CdpPageCreateIsolatedWorldResult>(
    debuggerSession,
    'Page.createIsolatedWorld',
    {
      frameId,
      worldName: 'cherry-webview-annotation-accessibility',
      grantUniveralAccess: false
    },
    deadline,
    signal
  )
  const executionContextId = world.executionContextId
  if (typeof executionContextId !== 'number') throw new Error('Webview isolated world is unavailable')

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
      deadline,
      signal
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
      deadline,
      signal
    )
    const backendNodeId = described.node?.backendNodeId
    if (!backendNodeId) throw new Error('Selected element has no backend DOM node')

    const ancestorsResult = await sendDebuggerCommand<{ nodes?: CdpAccessibilityNode[] }>(
      debuggerSession,
      'Accessibility.getAXNodeAndAncestors',
      { backendNodeId },
      deadline,
      signal
    )
    const ancestorNodes = ancestorsResult.nodes ?? []
    const selectedNode = ancestorNodes.find((node) => node.backendDOMNodeId === backendNodeId) ?? ancestorNodes[0]
    if (!selectedNode) throw new Error('Selected element has no accessibility node')

    const orderedAncestors = ancestorNodes
      .filter((node) => node.nodeId !== selectedNode.nodeId && !node.ignored)
      .reverse()
    let pathTruncated = orderedAncestors.length > ANNOTATION_EXPORT_LIMITS.accessibilityPath
    const limitedAncestors =
      orderedAncestors.length <= ANNOTATION_EXPORT_LIMITS.accessibilityPath
        ? orderedAncestors
        : [orderedAncestors[0], ...orderedAncestors.slice(-(ANNOTATION_EXPORT_LIMITS.accessibilityPath - 1))]
    const availablePathSlots = Math.max(0, Math.min(limitedAncestors.length, budget.remaining - 1))
    if (availablePathSlots < limitedAncestors.length) pathTruncated = true
    const path = limitedAncestors.slice(0, availablePathSlots).map(normalizeAccessibilityNode)
    budget.remaining -= path.length

    const walkState = { visited: 0, truncated: false }
    const selectedFrameId = selectedNode.frameId ?? ancestorNodes.find((node) => node.frameId)?.frameId
    const selectedIsIframe = annotation.element.tagName.toLowerCase() === 'iframe'
    const selectedIsFormControl = FORM_CONTROL_TAG_NAMES.has(annotation.element.tagName.toLowerCase())

    const walk = async (node: CdpAccessibilityNode, depth: number, isRoot: boolean): Promise<AccessibleNode[]> => {
      if (walkState.visited >= ANNOTATION_EXPORT_LIMITS.accessibilityNodes || budget.remaining <= 0) {
        walkState.truncated = true
        return []
      }

      walkState.visited++
      budget.remaining--
      const children: AccessibleNode[] = []
      const hasChildren = (node.childIds?.length ?? 0) > 0
      const atDepthLimit = depth >= ANNOTATION_EXPORT_LIMITS.accessibilityDepth
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
          deadline,
          signal
        )
        for (const child of childResult.nodes ?? []) {
          if (selectedFrameId && child.frameId && child.frameId !== selectedFrameId) continue
          children.push(...(await walk(child, depth + 1, false)))
          if (walkState.visited >= ANNOTATION_EXPORT_LIMITS.accessibilityNodes || budget.remaining <= 0) {
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
    await sendDebuggerCleanupCommand(debuggerSession, 'Runtime.releaseObjectGroup', { objectGroup }, deadline, signal)
  }
}
