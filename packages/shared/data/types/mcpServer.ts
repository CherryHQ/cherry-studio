/**
 * MCP Server entity types
 *
 * MCP Servers are user-configured Model Context Protocol server definitions
 * that provide tools and resources to AI assistants.
 */

import type { MCPConfigSample } from '@types'

/**
 * MCP Server type - communication protocol
 */
export type MCPServerType = 'stdio' | 'sse' | 'streamableHttp' | 'inMemory'

/**
 * MCP Server install source
 */
export type MCPServerInstallSource = 'builtin' | 'manual' | 'protocol' | 'unknown'

/**
 * Complete MCP Server entity as stored in database.
 *
 * Nullable DB columns are represented as optional (`?`) — the service layer
 * converts SQL NULL to `undefined` so consumers don't need to handle `null`.
 */
export interface MCPServer {
  /** Server ID */
  id: string
  /** Server name */
  name: string
  /** Communication type */
  type?: MCPServerType
  /** Server description */
  description?: string
  /** Server URL address */
  baseUrl?: string
  /** Command to start the server */
  command?: string
  /** Registry URL */
  registryUrl?: string
  /** Arguments passed to the command */
  args?: string[]
  /** Environment variables */
  env?: Record<string, string>
  /** Custom request headers */
  headers?: Record<string, string>
  /** Provider name */
  provider?: string
  /** Provider URL */
  providerUrl?: string
  /** Logo URL */
  logoUrl?: string
  /** Tags for categorization */
  tags?: string[]
  /** Whether the server is long running */
  longRunning?: boolean
  /** Timeout in seconds */
  timeout?: number
  /** DXT package version */
  dxtVersion?: string
  /** DXT package extracted path */
  dxtPath?: string
  /** Reference link */
  reference?: string
  /** Search key */
  searchKey?: string
  /** Configuration sample */
  configSample?: MCPConfigSample
  /** Disabled tools */
  disabledTools?: string[]
  /** Disabled auto-approve tools */
  disabledAutoApproveTools?: string[]
  /** Whether the server needs configuration */
  shouldConfig?: boolean
  /** Whether the server is active */
  isActive: boolean
  /** Install source */
  installSource?: MCPServerInstallSource
  /** Whether the server is trusted */
  isTrusted?: boolean
  /** Timestamp when trusted */
  trustedAt?: number
  /** Timestamp when installed */
  installedAt?: number
  /** Creation timestamp (ISO string) */
  createdAt?: string
  /** Last update timestamp (ISO string) */
  updatedAt?: string
}
