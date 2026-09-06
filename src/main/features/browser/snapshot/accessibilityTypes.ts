export type AccessibilityStatus =
  | 'available'
  | 'selector_not_found'
  | 'debugger_unavailable'
  | 'timeout'
  | 'capture_failed'
  | 'budget_exceeded'

export type AccessibilityStateName =
  | 'disabled'
  | 'expanded'
  | 'checked'
  | 'pressed'
  | 'selected'
  | 'required'
  | 'invalid'
  | 'readonly'

export interface AccessibilityState {
  name: AccessibilityStateName
  value: boolean | string
}

export interface AccessibleNodeSummary {
  role: string
  name: string | null
  description: string | null
  states: AccessibilityState[]
}

export interface AccessibleNode extends AccessibleNodeSummary {
  children: AccessibleNode[]
}

export interface AccessibilityContext {
  status: AccessibilityStatus
  path: AccessibleNodeSummary[]
  tree: AccessibleNode | null
  truncated: boolean
}

export interface AccessibilityCaptureBudget {
  remaining: number
}

export interface CdpValue {
  value?: unknown
}

export interface CdpAccessibilityProperty {
  name: string
  value?: CdpValue
}

export interface CdpAccessibilityNode {
  nodeId: string
  ignored: boolean
  role?: CdpValue
  name?: CdpValue
  value?: CdpValue
  description?: CdpValue
  properties?: CdpAccessibilityProperty[]
  parentId?: string
  childIds?: string[]
  backendDOMNodeId?: number
  frameId?: string
}

export interface CdpRuntimeEvaluateResult {
  result?: {
    objectId?: string
    subtype?: string
  }
  exceptionDetails?: unknown
}

export interface CdpPageGetFrameTreeResult {
  frameTree?: {
    frame?: {
      id?: string
    }
  }
}

export interface CdpPageCreateIsolatedWorldResult {
  executionContextId?: number
}
