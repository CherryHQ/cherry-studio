import type {
  CacheMode,
  CallToolResult,
  CreateMessageRequestParamsBase,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  GetPromptResult,
  Prompt,
  ProtocolEra,
  ReadResourceResult,
  Resource,
  Root,
  Tool
} from '@modelcontextprotocol/client'

export interface McpInteractionContext {
  windowId?: string
  topicId?: string
  model?: string
  roots?: ReadonlyArray<Root>
  requestElicitation?: (request: ElicitRequest, signal: AbortSignal) => Promise<ElicitResult>
  sample?: (request: CreateMessageRequestParamsBase, signal: AbortSignal) => Promise<CreateMessageResult>
  requestRoots?: (roots: ReadonlyArray<Root>, signal: AbortSignal) => Promise<boolean>
}

export interface McpConnectionEvents {
  toolsChanged(error: Error | null, tools: Tool[] | null): void
  promptsChanged(error: Error | null, prompts: Prompt[] | null): void
  resourcesChanged(error: Error | null, resources: Resource[] | null): void
  resourceUpdated(): void
  log(level: string, logger: string | undefined, data: unknown): void
}

export interface McpCallToolOptions {
  signal: AbortSignal
  timeoutMs: number
  resetTimeoutOnProgress?: boolean
  maxTotalTimeoutMs?: number
  interactionContext?: McpInteractionContext
  onProgress?: (progress: number, total?: number) => void
}

/**
 * Main-only MCP connection boundary. Raw SDK clients, transports, envelopes,
 * resultType and requestState never cross this interface.
 */
export interface McpConnection {
  readonly era: ProtocolEra
  readonly serverVersion: string | null

  listTools(cacheMode?: CacheMode): Promise<Tool[]>
  callTool(name: string, args: unknown, options: McpCallToolOptions): Promise<CallToolResult>
  listPrompts(cacheMode?: CacheMode): Promise<Prompt[]>
  getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult>
  listResources(cacheMode?: CacheMode): Promise<Resource[]>
  readResource(uri: string, cacheMode?: CacheMode): Promise<ReadResourceResult>
  health(): Promise<void>
  close(): Promise<void>
}
