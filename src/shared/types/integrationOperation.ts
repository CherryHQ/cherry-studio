import * as z from 'zod'

export const integrationActionSchema = z.enum([
  'pull',
  'start',
  'stop',
  'restart',
  'status',
  'logs',
  'index',
  'refresh',
  'check-drift',
  'install-skills',
  'repair-path',
  'diagnose',
  'uar-check',
  'uar-apply',
  'uar-restart',
  'discover-services'
])

export type IntegrationAction = z.infer<typeof integrationActionSchema>
export type IntegrationOperationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
export type IntegrationOperationStage =
  | 'queued'
  | 'detecting'
  | 'preparing'
  | 'pulling'
  | 'starting'
  | 'authenticating'
  | 'running'
  | 'stopping'
  | 'restarting'
  | 'checking'
  | 'indexing'
  | 'publishing'
  | 'refreshing'
  | 'finalizing'
  | 'completed'

export type IntegrationDiagnostic = {
  id: string
  state: 'operational' | 'listening' | 'authenticated' | 'failed' | 'disabled'
  detail?: string
}

export type IntegrationOperationProgress = {
  current: number
  total: number
  unit?: string
}

export type IntegrationOperation = {
  id: string
  action: IntegrationAction
  workspacePath?: string
  target: string
  resourceKeys: string[]
  status: IntegrationOperationStatus
  stage: IntegrationOperationStage
  progress?: IntegrationOperationProgress
  cursor: number
  output: string
  errorCode?: string
  error?: string
  result?: string
  recoveryAction?: string
  startedAt: number
  updatedAt: number
  completedAt?: number
  exitCode?: number
  diagnostics?: IntegrationDiagnostic[]
}

export type IntegrationOperationEvent = {
  operationId: string
  sequence: number
  at: number
  kind: 'status' | 'stage' | 'progress' | 'output' | 'diagnostics'
  status?: IntegrationOperationStatus
  stage?: IntegrationOperationStage
  progress?: IntegrationOperationProgress
  output?: string
  diagnostics?: IntegrationDiagnostic[]
  errorCode?: string
  error?: string
  result?: string
  recoveryAction?: string
}

export type IntegrationOperationEventPage = {
  operation: IntegrationOperation
  events: IntegrationOperationEvent[]
  cursor: number
}

export type IntegrationOperationLogPage = {
  operationId: string
  offset: number
  nextOffset: number
  totalBytes: number
  text: string
  eof: boolean
}

export type IntegrationOperationLogExport = {
  operationId: string
  cancelled: boolean
  path?: string
  size?: number
}
