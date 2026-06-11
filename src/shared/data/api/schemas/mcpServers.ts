/**
 * MCP Server API Schema definitions
 *
 * Contains endpoints for MCP server CRUD operations and listing.
 * Entity schemas and types live in `@shared/data/types/mcpServer`.
 */

import * as z from 'zod'

import { type McpServer, McpServerSchema, McpServerTypeSchema } from '../../types/mcpServer'
import type { OffsetPaginationResponse } from '../apiTypes'

/**
 * Mutable MCP server fields — explicit whitelist of everything a client may write.
 * Anything not listed here (id, createdAt, updatedAt, future auto-managed columns)
 * is rejected at the API boundary by default.
 */
const MCP_SERVER_MUTABLE_FIELDS = {
  name: true,
  type: true,
  description: true,
  baseUrl: true,
  command: true,
  registryUrl: true,
  args: true,
  env: true,
  headers: true,
  provider: true,
  providerUrl: true,
  logoUrl: true,
  tags: true,
  longRunning: true,
  timeout: true,
  dxtVersion: true,
  dxtPath: true,
  reference: true,
  searchKey: true,
  configSample: true,
  disabledTools: true,
  disabledAutoApproveTools: true,
  shouldConfig: true,
  sortOrder: true,
  isActive: true,
  installSource: true,
  isTrusted: true,
  trustedAt: true,
  installedAt: true
} as const

/**
 * DTO for creating a new MCP server.
 * - `name` is required (non-empty)
 * - `id` is excluded (auto-generated UUID by database)
 * - All other fields are optional
 */
export const CreateMcpServerSchema = McpServerSchema.pick(MCP_SERVER_MUTABLE_FIELDS).partial().required({ name: true })
export type CreateMcpServerDto = z.infer<typeof CreateMcpServerSchema>

/**
 * DTO for updating an existing MCP server. All fields optional, chain-derived from Create.
 */
export const UpdateMcpServerSchema = CreateMcpServerSchema.partial()
export type UpdateMcpServerDto = z.infer<typeof UpdateMcpServerSchema>

/**
 * Query parameters for listing MCP servers
 */
export const ListMcpServersQuerySchema = z.object({
  /** Filter by server ID */
  id: z.string().optional(),
  /** Filter by active state */
  isActive: z.boolean().optional(),
  /** Filter by server type */
  type: McpServerTypeSchema.optional()
})
export type ListMcpServersQuery = z.infer<typeof ListMcpServersQuerySchema>

/**
 * Body for reordering MCP servers
 */
export const ReorderMcpServersSchema = z.object({
  orderedIds: z.array(z.string().min(1))
})
export type ReorderMcpServersBody = z.infer<typeof ReorderMcpServersSchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * MCP Server API Schema definitions
 */
export type McpServerSchemas = {
  /**
   * MCP servers collection endpoint
   * @example GET /mcp-servers?isActive=true
   * @example POST /mcp-servers { "name": "My Server", "type": "stdio", "command": "npx" }
   */
  '/mcp-servers': {
    /** List all MCP servers with optional filters */
    GET: {
      query?: ListMcpServersQuery
      response: OffsetPaginationResponse<McpServer>
    }
    /** Create a new MCP server */
    POST: {
      body: CreateMcpServerDto
      response: McpServer
    }
    /** Partial update of the collection (reorder) */
    PATCH: {
      body: ReorderMcpServersBody
      response: void
    }
  }

  /**
   * Individual MCP server endpoint
   * @example GET /mcp-servers/abc123
   * @example PATCH /mcp-servers/abc123 { "isActive": true }
   * @example DELETE /mcp-servers/abc123
   */
  '/mcp-servers/:id': {
    /** Get an MCP server by ID */
    GET: {
      params: { id: string }
      response: McpServer
    }
    /** Update an MCP server */
    PATCH: {
      params: { id: string }
      body: UpdateMcpServerDto
      response: McpServer
    }
    /** Delete an MCP server */
    DELETE: {
      params: { id: string }
      response: void
    }
  }
}
