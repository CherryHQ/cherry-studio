import type { MCPServer, MCPTool } from '@types'

export interface GeneratedTool {
  serverId: string
  serverName: string
  toolName: string
  functionName: string
  jsCode: string
  fn: (params: unknown) => Promise<unknown>
  signature: string
  returns: string
  description?: string
}

export interface SearchQuery {
  query: string
  limit?: number
}

export interface SearchResult {
  tools: string
  total: number
}

export interface ExecInput {
  code: string
}

export type ExecOutput = {
  result: unknown
  logs?: string[]
  error?: string
  isError?: boolean
}

export interface ToolRegistryOptions {
  ttl?: number
}

export interface MCPToolWithServer extends MCPTool {
  server: MCPServer
}

export interface ExecutionContext {
  __callTool: (functionName: string, params: unknown) => Promise<unknown>
  parallel: <T>(...promises: Promise<T>[]) => Promise<T[]>
  settle: <T>(...promises: Promise<T>[]) => Promise<PromiseSettledResult<T>[]>
  console: ConsoleMethods
  [functionName: string]: unknown
}

export interface ConsoleMethods {
  log: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
}

export type HubWorkerTool = {
  functionName: string
}

export type HubWorkerExecMessage = {
  type: 'exec'
  code: string
  tools: HubWorkerTool[]
}

export type HubWorkerCallToolMessage = {
  type: 'callTool'
  requestId: string
  functionName: string
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
