import type {
  CacheMode,
  CallToolResult,
  ClientCapabilities,
  InputRequiredResult,
  CreateMessageRequestParamsBase,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  GetPromptResult,
  ListResourceTemplatesResult,
  Prompt,
  ProtocolEra,
  ReadResourceResult,
  Resource,
  Root,
  ServerCapabilities,
  Tool
} from '@modelcontextprotocol/client'

export interface McpInteractionContext {
  windowId?: string
  topicId?: string
  sessionId?: string
  requestId?: string
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
  resourceUpdated(uri: string): void
  log(level: string, logger: string | undefined, data: unknown): void
}

export type McpResourceObservationState = 'subscribed' | 'reconnecting' | 'unsupported' | 'closed'
export interface McpResourceObservation {
  close(): Promise<void>
}

export interface McpRequestOptions {
  signal: AbortSignal
  timeoutMs: number
  resetTimeoutOnProgress?: boolean
  maxTotalTimeoutMs?: number
  interactionContext?: McpInteractionContext
}

export interface McpCallToolOptions extends McpRequestOptions {
  onProgress?: (progress: number, total?: number) => void
}

export type McpForwardMethod = 'tools/call' | 'prompts/get' | 'resources/read'
export type McpForwardResult = CallToolResult | GetPromptResult | ReadResourceResult | InputRequiredResult
export interface McpForwardOptions extends McpCallToolOptions {
  capabilities: ClientCapabilities
}

/**
 * Main-only MCP connection boundary. Desktop callers receive completed results;
 * forwardRequest preserves opaque MRTR state for an external gateway client.
 * SDK clients and transports remain private to the connection implementation.
 */
export interface McpConnection {
  readonly era: ProtocolEra
  readonly serverVersion: string | null
  readonly serverCapabilities: ServerCapabilities | undefined
  readonly instructions: string | undefined

  listTools(cacheMode?: CacheMode): Promise<Tool[]>
  callTool(name: string, args: unknown, options: McpCallToolOptions): Promise<CallToolResult>
  forwardRequest(
    method: McpForwardMethod,
    params: Record<string, unknown>,
    options: McpForwardOptions
  ): Promise<McpForwardResult>
  listPrompts(cacheMode?: CacheMode): Promise<Prompt[]>
  getPrompt(name: string, args?: Record<string, string>, options?: McpRequestOptions): Promise<GetPromptResult>
  listResources(cacheMode?: CacheMode): Promise<Resource[]>
  listResourceTemplates(cacheMode?: CacheMode): Promise<ListResourceTemplatesResult['resourceTemplates']>
  readResource(uri: string, cacheMode?: CacheMode, options?: McpRequestOptions): Promise<ReadResourceResult>
  observeResource(uri: string, onState: (state: McpResourceObservationState) => void): McpResourceObservation
  health(): Promise<void>
  close(): Promise<void>
}
