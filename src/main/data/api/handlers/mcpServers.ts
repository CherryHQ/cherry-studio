/**
 * MCP Server API Handlers
 *
 * Implements all MCP server-related API endpoints including:
 * - MCP server CRUD operations
 * - Listing with optional filters
 */

import { mcpServerService } from '@data/services/McpServerService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { MCPServerSchemas } from '@shared/data/api/schemas/mcpServers'

/**
 * Handler type for a specific MCP server endpoint
 */
type MCPServerHandler<Path extends keyof MCPServerSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

/**
 * MCP Server API handlers implementation
 */
export const mcpServerHandlers: {
  [Path in keyof MCPServerSchemas]: {
    [Method in keyof MCPServerSchemas[Path]]: MCPServerHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/mcp-servers': {
    GET: async ({ query }) => {
      return await mcpServerService.list(query ?? {})
    },

    POST: async ({ body }) => {
      return await mcpServerService.create(body)
    }
  },

  '/mcp-servers/reorder': {
    PUT: async ({ body }) => {
      await mcpServerService.reorder(body.orderedIds)
      return undefined
    }
  },

  '/mcp-servers/:id': {
    GET: async ({ params }) => {
      return await mcpServerService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      return await mcpServerService.update(params.id, body)
    },

    DELETE: async ({ params }) => {
      await mcpServerService.delete(params.id)
      return undefined
    }
  }
}
