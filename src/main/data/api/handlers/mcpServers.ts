/**
 * MCP Server API Handlers
 *
 * Implements all MCP server-related API endpoints including:
 * - MCP server CRUD operations
 * - Listing with optional filters
 *
 * All input validation happens here at the system boundary.
 */

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import type { McpServerSchemas } from '@shared/data/api/schemas/mcpServers'
import {
  CreateMcpServerSchema,
  ListMcpServersQuerySchema,
  ReorderMcpServersSchema,
  UpdateMcpServerSchema
} from '@shared/data/api/schemas/mcpServers'
import type { HandlersFor } from '@shared/data/api/types'
import { isBuiltinMcpServerName } from '@shared/utils/mcp'

export const mcpServerHandlers: HandlersFor<McpServerSchemas> = {
  '/mcp-servers': {
    GET: async ({ query }) => {
      const parsed = ListMcpServersQuerySchema.parse(query ?? {})
      return mcpServerService.list(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreateMcpServerSchema.parse(body)
      const server = mcpServerService.create(parsed)
      // Builtin names look like `@cherry/fetch`; report the preset slug, never a user-chosen name.
      const builtin = server.installSource === 'builtin' && isBuiltinMcpServerName(server.name)
      application.get('AnalyticsService').trackProductEvent({
        event: 'feature_used',
        feature: 'mcp',
        action: 'server_added',
        ...(builtin && { target: server.name.replace('@cherry/', '') })
      })
      return server
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
    }
  }
}
