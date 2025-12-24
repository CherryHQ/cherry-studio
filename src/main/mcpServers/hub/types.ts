import type { MCPServer, MCPTool } from '@types'

export interface GeneratedTool {
  serverId: string
  serverName: string
  toolName: string
  toolId: string
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

export interface ExecOutput {
  result: unknown
  logs?: string[]
  error?: string
}

export interface ToolRegistryOptions {
  ttl?: number
}

export interface MCPToolWithServer extends MCPTool {
  server: MCPServer
}

export interface ExecutionContext {
  __callTool: (toolId: string, params: unknown) => Promise<unknown>
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
