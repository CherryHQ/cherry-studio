import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { SSEClientTransport, SseError } from '@modelcontextprotocol/sdk/client/sse.js'
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type {
  StreamableHTTPClientTransport,
  StreamableHTTPError
} from '@modelcontextprotocol/sdk/client/streamableHttp'
import type { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory'
import type {
  CancelledNotificationSchema,
  LoggingMessageNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ToolListChangedNotificationSchema
} from '@modelcontextprotocol/sdk/types.js'
import type { McpServer, McpServerType } from '@shared/data/types/mcpServer'
import { normalizeMcpBaseUrl } from '@shared/utils/mcp'

export type McpClientSdk = {
  Client: typeof Client
  SSEClientTransport: typeof SSEClientTransport
  SseError: typeof SseError
  StdioClientTransport: typeof StdioClientTransport
  StreamableHTTPClientTransport: typeof StreamableHTTPClientTransport
  StreamableHTTPError: typeof StreamableHTTPError
  InMemoryTransport: typeof InMemoryTransport
  CancelledNotificationSchema: typeof CancelledNotificationSchema
  LoggingMessageNotificationSchema: typeof LoggingMessageNotificationSchema
  PromptListChangedNotificationSchema: typeof PromptListChangedNotificationSchema
  ResourceListChangedNotificationSchema: typeof ResourceListChangedNotificationSchema
  ResourceUpdatedNotificationSchema: typeof ResourceUpdatedNotificationSchema
  ToolListChangedNotificationSchema: typeof ToolListChangedNotificationSchema
}

export type McpTransport = StdioClientTransport | SSEClientTransport | InMemoryTransport | StreamableHTTPClientTransport

let mcpClientSdkPromise: Promise<McpClientSdk> | undefined

export function loadMcpClientSdk(): Promise<McpClientSdk> {
  mcpClientSdkPromise ??= Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/sse.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp'),
    import('@modelcontextprotocol/sdk/inMemory'),
    import('@modelcontextprotocol/sdk/types.js')
  ]).then(([client, sse, stdio, streamableHttp, inMemory, types]) => ({
    Client: client.Client,
    SSEClientTransport: sse.SSEClientTransport,
    SseError: sse.SseError,
    StdioClientTransport: stdio.StdioClientTransport,
    StreamableHTTPClientTransport: streamableHttp.StreamableHTTPClientTransport,
    StreamableHTTPError: streamableHttp.StreamableHTTPError,
    InMemoryTransport: inMemory.InMemoryTransport,
    CancelledNotificationSchema: types.CancelledNotificationSchema,
    LoggingMessageNotificationSchema: types.LoggingMessageNotificationSchema,
    PromptListChangedNotificationSchema: types.PromptListChangedNotificationSchema,
    ResourceListChangedNotificationSchema: types.ResourceListChangedNotificationSchema,
    ResourceUpdatedNotificationSchema: types.ResourceUpdatedNotificationSchema,
    ToolListChangedNotificationSchema: types.ToolListChangedNotificationSchema
  }))
  return mcpClientSdkPromise
}

// Order in which to attempt the URL-based transports for a given server. We try the
// user-configured type first (no behavior change for correctly configured servers) and,
// if that fails with a transport-level protocol error, retry with the other transport.
// This bridges legacy SSE servers and modern Streamable HTTP servers (which reject the
// SSE GET handshake with 405) without the user having to know the difference.
export function getTransportCandidates(server: McpServer): McpServerType[] | null {
  if (!normalizeMcpBaseUrl(server.baseUrl)) return null
  if (server.type === 'sse') return ['sse', 'streamableHttp']
  if (server.type === 'streamableHttp') return ['streamableHttp', 'sse']
  return null
}

// A transport-level protocol error that indicates a *transport/protocol mismatch* (not an
// auth, permission, or generic server error) and is worth retrying against the alternative
// transport. The issue's 405 is the canonical signal: the SSE GET handshake is rejected
// (server is actually Streamable HTTP) or the Streamable HTTP POST is rejected. A 404 on the
// Streamable HTTP POST covers a legacy SSE server (no /mcp route) that was configured as
// streamableHttp. We deliberately exclude 401/403/5xx so OAuth and real server errors surface
// instead of being masked by a confusing fallback failure.
export function isTransportFallbackError(error: unknown, sdk: McpClientSdk): boolean {
  if (error instanceof sdk.SseError) return error.code === 405
  if (error instanceof sdk.StreamableHTTPError) return error.code === 405 || error.code === 404
  return false
}
