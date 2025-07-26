import { Hono } from 'hono'

import { loggerService } from '../../services/LoggerService'
import { mcpApiService } from '../services/MCPApiService'

const logger = loggerService.withContext('ApiServerMCPRoutes')

const app = new Hono()

// List all MCP servers
app.get('/', async (c) => {
  try {
    logger.info('Get all MCP servers request received')
    const servers = await mcpApiService.getAllServers()
    return c.json({
      success: true,
      data: servers
    })
  } catch (error: any) {
    logger.error('Error fetching MCP servers:', error)
    return c.json(
      {
        success: false,
        error: {
          message: `Failed to retrieve MCP servers: ${error.message}`,
          type: 'service_unavailable',
          code: 'servers_unavailable'
        }
      },
      503
    )
  }
})

// Get specific MCP server info
app.get('/:server_id', async (c) => {
  try {
    logger.info('Get MCP server info request received')
    const server = await mcpApiService.getServerInfo(c.req.param('server_id'))
    if (!server) {
      logger.warn('MCP server not found')
      return c.json(
        {
          success: false,
          error: {
            message: 'MCP server not found',
            type: 'not_found',
            code: 'server_not_found'
          }
        },
        404
      )
    }
    return c.json({
      success: true,
      data: server
    })
  } catch (error: any) {
    logger.error('Error fetching MCP server info:', error)
    return c.json(
      {
        success: false,
        error: {
          message: `Failed to retrieve MCP server info: ${error.message}`,
          type: 'service_unavailable',
          code: 'server_info_unavailable'
        }
      },
      503
    )
  }
})

// Connect to MCP server
app.all('/:server_id/mcp', async (c) => {
  const server = await mcpApiService.getServerById(c.req.param('server_id'))
  if (!server) {
    logger.warn('MCP server not found')
    return c.json(
      {
        success: false,
        error: {
          message: 'MCP server not found',
          type: 'not_found',
          code: 'server_not_found'
        }
      },
      404
    )
  }
  return await mcpApiService.handleRequest(c, server)
})

export { app as mcpRoutes }
