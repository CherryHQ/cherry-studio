/**
 * MCP Server API Schema definitions
 *
 * Contains all MCP server-related endpoints for CRUD operations and listing.
 * DTOs are derived from the MCPServer entity type to stay in sync with the DB schema.
 */

import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type { MCPServer, MCPServerType } from '@shared/data/types/mcpServer'

// ============================================================================
// DTO Derivation Utilities
// ============================================================================

/** Fields auto-managed by the database layer, excluded from DTOs */
type AutoFields = 'id' | 'createdAt' | 'updatedAt'

// ============================================================================
// DTOs (derived from MCPServer entity)
// ============================================================================

/**
 * DTO for creating a new MCP server.
 * - `name` is required
 * - All other fields are optional
 */
export type CreateMCPServerDto = Pick<MCPServer, 'name'> & Partial<Omit<MCPServer, AutoFields | 'name'>>

/**
 * DTO for updating an existing MCP server.
 * - All fields optional
 */
export type UpdateMCPServerDto = Partial<Omit<MCPServer, AutoFields>>

/**
 * Query parameters for listing MCP servers
 */
export interface ListMCPServersQuery {
  /** Filter by active state */
  isActive?: boolean
  /** Filter by server type */
  type?: MCPServerType
}

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
