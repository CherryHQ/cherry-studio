/**
 * MCP Server API Schema definitions
 *
 * Contains endpoints for MCP server CRUD operations and listing.
 * Entity schemas and types live in `@shared/data/types/mcpServer`.
 */

import * as z from 'zod'

import { type MCPServer, MCPServerSchema, MCPServerTypeSchema } from '../../types/mcpServer'
import type { OffsetPaginationResponse } from '../apiTypes'

// ============================================================================
// DTO Derivation
// ============================================================================

/** Fields auto-managed by the database layer, excluded from DTOs */
const AutoFields = { id: true, createdAt: true, updatedAt: true } as const

/**
 * DTO for creating a new MCP server.
 * - `name` is required (non-empty)
 * - `id` is excluded (auto-generated UUID by database)
 * - All other fields are optional
 */
export const CreateMCPServerSchema = MCPServerSchema.omit(AutoFields).partial().required({ name: true })
export type CreateMCPServerDto = z.infer<typeof CreateMCPServerSchema>

/**
 * DTO for updating an existing MCP server.
 * All fields optional, `id` excluded (comes from URL path).
 */
export const UpdateMCPServerSchema = MCPServerSchema.omit(AutoFields).partial()
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
    /** Partial update of the collection (reorder) */
    PATCH: {
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
