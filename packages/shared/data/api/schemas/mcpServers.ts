/**
 * MCP Server API Schema definitions
 *
 * Contains endpoints for MCP server CRUD operations and listing.
 * Entity schemas and types live in `@shared/data/types/mcpServer`.
 */

import * as z from 'zod'

import { type MCPServer, MCPServerInstallSourceSchema, MCPServerTypeSchema } from '../../types/mcpServer'
import type { OffsetPaginationResponse } from '../apiTypes'

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating a new MCP server.
 * - `name` is required (non-empty)
 * - `id` is optional (auto-generated if omitted)
 * - All other fields are optional
 */
export const CreateMCPServerSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  type: MCPServerTypeSchema.optional(),
  description: z.string().optional(),
  baseUrl: z.string().optional(),
  command: z.string().optional(),
  registryUrl: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  provider: z.string().optional(),
  providerUrl: z.string().optional(),
  logoUrl: z.string().optional(),
  tags: z.array(z.string()).optional(),
  longRunning: z.boolean().optional(),
  timeout: z.number().optional(),
  dxtVersion: z.string().optional(),
  dxtPath: z.string().optional(),
  reference: z.string().optional(),
  searchKey: z.string().optional(),
  disabledTools: z.array(z.string()).optional(),
  disabledAutoApproveTools: z.array(z.string()).optional(),
  shouldConfig: z.boolean().optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
  installSource: MCPServerInstallSourceSchema.optional(),
  isTrusted: z.boolean().optional(),
  trustedAt: z.number().optional(),
  installedAt: z.number().optional()
})
export type CreateMCPServerDto = z.infer<typeof CreateMCPServerSchema>

/**
 * DTO for updating an existing MCP server.
 * All fields optional.
 */
export const UpdateMCPServerSchema = z.object({
  name: z.string().min(1).optional(),
  type: MCPServerTypeSchema.optional(),
  description: z.string().optional(),
  baseUrl: z.string().optional(),
  command: z.string().optional(),
  registryUrl: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  provider: z.string().optional(),
  providerUrl: z.string().optional(),
  logoUrl: z.string().optional(),
  tags: z.array(z.string()).optional(),
  longRunning: z.boolean().optional(),
  timeout: z.number().optional(),
  dxtVersion: z.string().optional(),
  dxtPath: z.string().optional(),
  reference: z.string().optional(),
  searchKey: z.string().optional(),
  disabledTools: z.array(z.string()).optional(),
  disabledAutoApproveTools: z.array(z.string()).optional(),
  shouldConfig: z.boolean().optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
  installSource: MCPServerInstallSourceSchema.optional(),
  isTrusted: z.boolean().optional(),
  trustedAt: z.number().optional(),
  installedAt: z.number().optional()
})
export type UpdateMCPServerDto = z.infer<typeof UpdateMCPServerSchema>

/**
 * Query parameters for listing MCP servers
 */
export const ListMCPServersQuerySchema = z.object({
  /** Filter by server ID */
  id: z.string().optional(),
  /** Filter by active state */
  isActive: z.boolean().optional(),
  /** Filter by server type */
  type: MCPServerTypeSchema.optional()
})
export type ListMCPServersQuery = z.infer<typeof ListMCPServersQuerySchema>

/**
 * Body for reordering MCP servers
 */
export const ReorderMCPServersSchema = z.object({
  orderedIds: z.array(z.string().min(1))
})
export type ReorderMCPServersBody = z.infer<typeof ReorderMCPServersSchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * MCP Server API Schema definitions
 */
export interface MCPServerSchemas {
  /**
   * MCP servers collection endpoint
   * @example GET /mcp-servers?isActive=true
   * @example POST /mcp-servers { "name": "My Server", "type": "stdio", "command": "npx" }
   */
  '/mcp-servers': {
    /** List all MCP servers with optional filters */
    GET: {
      query?: ListMCPServersQuery
      response: OffsetPaginationResponse<MCPServer>
    }
    /** Create a new MCP server */
    POST: {
      body: CreateMCPServerDto
      response: MCPServer
    }
  }

  /**
   * Reorder MCP servers endpoint
   */
  '/mcp-servers/reorder': {
    /** Reorder MCP servers by providing ordered IDs */
    PUT: {
      body: ReorderMCPServersBody
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
      response: MCPServer
    }
    /** Update an MCP server */
    PATCH: {
      params: { id: string }
      body: UpdateMCPServerDto
      response: MCPServer
    }
    /** Delete an MCP server */
    DELETE: {
      params: { id: string }
      response: void
    }
  }
}
