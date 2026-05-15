/**
 * MCP Server API Handlers
 *
 * Implements all MCP server-related API endpoints including:
 * - MCP server CRUD operations
 * - Listing with optional filters
 *
 * All input validation happens here at the system boundary.
 */

import { mcpServerService } from '@data/services/McpServerService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import type { MCPServerSchemas } from '@shared/data/api/schemas/mcpServers'
import {
  CreateMCPServerSchema,
  ListMCPServersQuerySchema,
  ReorderMCPServersSchema,
  UpdateMCPServerSchema
} from '@shared/data/api/schemas/mcpServers'

export const mcpServerHandlers: HandlersFor<MCPServerSchemas> = {
  '/mcp-servers': {
    GET: async ({ query }) => {
      const parsed = ListMCPServersQuerySchema.parse(query ?? {})
      return await mcpServerService.list(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreateMCPServerSchema.parse(body)
      return await mcpServerService.create(parsed)
    },

    PATCH: async ({ body }) => {
      const parsed = ReorderMCPServersSchema.parse(body)
      await mcpServerService.reorder(parsed.orderedIds)
      return undefined
    }
  },

  '/mcp-servers/:id': {
    GET: async ({ params }) => {
      return await mcpServerService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateMCPServerSchema.parse(body)
      return await mcpServerService.update(params.id, parsed)
    },

    DELETE: async ({ params }) => {
      await mcpServerService.delete(params.id)
      return undefined
    }
  }
}
