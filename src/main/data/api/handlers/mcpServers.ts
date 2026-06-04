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
import type { McpServerSchemas } from '@shared/data/api/schemas/mcpServers'
import {
  CreateMcpServerSchema,
  ListMcpServersQuerySchema,
  ReorderMcpServersSchema,
  UpdateMcpServerSchema
} from '@shared/data/api/schemas/mcpServers'

export const mcpServerHandlers: HandlersFor<McpServerSchemas> = {
  '/mcp-servers': {
    GET: async ({ query }) => {
      const parsed = ListMcpServersQuerySchema.parse(query ?? {})
      return await mcpServerService.list(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreateMcpServerSchema.parse(body)
      return await mcpServerService.create(parsed)
    },

    PATCH: async ({ body }) => {
      const parsed = ReorderMcpServersSchema.parse(body)
      await mcpServerService.reorder(parsed.orderedIds)
      return undefined
    }
  },

  '/mcp-servers/:id': {
    GET: async ({ params }) => {
      return await mcpServerService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateMcpServerSchema.parse(body)
      return await mcpServerService.update(params.id, parsed)
    },

    DELETE: async ({ params }) => {
      await mcpServerService.delete(params.id)
      return undefined
    }
  }
}
