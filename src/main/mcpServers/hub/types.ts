export type HubTool = {
  /** namespaced id: serverId__toolName */
  id: string
  serverId: string
  serverName: string
  toolName: string
  description?: string
  inputSchema?: unknown
  /** JS-friendly name (camelCase) */
  jsName: string
}

export type ListInput = {
  /** Optional: maximum results to return (default: 30, max: 100). */
  limit?: number
  /** Optional: zero-based offset for pagination (default: 0). */
  offset?: number
}

export type InspectInput = {
  /** Tool name in JS form (camelCase) OR original namespaced id (serverId__toolName). */
  name: string
}

export type InvokeInput = {
  /** Tool name in JS form (camelCase) OR original namespaced id (serverId__toolName). */
  name: string
  /** Tool parameters as JSON object. */
  params?: unknown
}

export type ExecInput = {
  code: string
}

export type ExecOutput = {
  result: unknown
  logs?: string[]
  error?: string
  isError?: boolean
}

export type HubWorkerExecMessage = {
  type: 'exec'
  code: string
}

export type HubWorkerCallToolMessage = {
  type: 'callTool'
  requestId: string
  name: string
  params: unknown
}

export type HubWorkerToolResultMessage = {
  type: 'toolResult'
  requestId: string
  result: unknown
}

export type HubWorkerToolErrorMessage = {
  type: 'toolError'
  requestId: string
  error: string
}

export type HubWorkerResultMessage = {
  type: 'result'
  result: unknown
  logs?: string[]
}

export type HubWorkerErrorMessage = {
  type: 'error'
  error: string
  logs?: string[]
}

export type HubWorkerLogMessage = {
  type: 'log'
  entry: string
}

export type HubWorkerMessage =
  | HubWorkerExecMessage
  | HubWorkerCallToolMessage
  | HubWorkerToolResultMessage
  | HubWorkerToolErrorMessage
  | HubWorkerResultMessage
  | HubWorkerErrorMessage
  | HubWorkerLogMessage
