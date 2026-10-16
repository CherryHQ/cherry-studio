import type { UtilityProcessMethod } from '@main/core/utilityProcess/types'

export interface AutomationBinding {
  name: string
  declared: true
  kind: 'let' | 'const' | 'class' | 'global'
  type?: string
  readable: boolean
  canAssign: boolean
  canRedeclare: boolean
}

export interface AutomationContext {
  generation: string | null
  cell: string
  state: 'retained' | 'cleared'
  execution: 'not-started' | 'started' | 'completed' | 'interrupted'
  hostCallsStarted: number
  bindings: AutomationBinding[]
  truncated: boolean
}

export interface AutomationExecution {
  events: Array<{
    domain: string
    operation: string
    target?: string
    status: 'completed' | 'failed'
    error?: { code: string; effect: string; message: string }
  }>
  omitted: number
}

export interface AutomationKernelContract {
  methods: {
    execute: UtilityProcessMethod<
      { code: string; bootstrap: string },
      { text: string; isError?: boolean; context: Omit<AutomationContext, 'cell'> }
    >
  }
}

export interface AutomationOwner {
  kind: 'agent' | 'topic'
  sessionId: string
  ownerId: string
  label: string
}

export interface AutomationAccess {
  browser: boolean
  computer: boolean
}
