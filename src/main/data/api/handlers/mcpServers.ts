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
import type { McpServerSchemas } from '@shared/data/api/schemas/mcpServers'
import {
  CreateMcpServerSchema,
  ListMcpServersQuerySchema,
  ReorderMcpServersSchema,
  UpdateMcpServerSchema
} from '@shared/data/api/schemas/mcpServers'
import type { HandlersFor } from '@shared/data/api/types'

export const mcpServerHandlers: HandlersFor<McpServerSchemas> = {
  '/mcp-servers': {
    GET: async ({ query }) => {
      const parsed = ListMcpServersQuerySchema.parse(query ?? {})
      return mcpServerService.list(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreateMcpServerSchema.parse(body)
      return mcpServerService.create(parsed)
    },

    PATCH: async ({ body }) => {
      const parsed = ReorderMcpServersSchema.parse(body)
      mcpServerService.reorder(parsed.orderedIds)
      return undefined
    }
  },

  '/mcp-servers/:id': {
    GET: async ({ params }) => {
      return mcpServerService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateMcpServerSchema.parse(body)
      return mcpServerService.update(params.id, parsed)
    },

    DELETE: async ({ params }) => {
      mcpServerService.delete(params.id)
      return undefined
    }
  }
}
