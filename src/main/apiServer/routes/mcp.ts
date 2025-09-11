import express, { Request, Response } from 'express'

import { loggerService } from '../../services/LoggerService'
import { mcpApiService } from '../services/mcp'

const logger = loggerService.withContext('ApiServerMCPRoutes')

const router = express.Router()

/**
 * @swagger
 * /v1/mcps:
 *   get:
 *     summary: List MCP servers
 *     description: Get a list of all configured Model Context Protocol servers
 *     tags: [MCP]
 *     responses:
 *       200:
 *         description: List of MCP servers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MCPServer'
 *       503:
 *         description: Service unavailable
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   $ref: '#/components/schemas/Error'
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    logger.info('Get all MCP servers request received')
    const servers = await mcpApiService.getAllServers(req)
    return res.json({
      success: true,
      data: servers
    })
  } catch (error: any) {
    logger.error('Error fetching MCP servers:', error)
    return res.status(503).json({
      success: false,
      error: {
        message: `Failed to retrieve MCP servers: ${error.message}`,
        type: 'service_unavailable',
        code: 'servers_unavailable'
      }
    })
  }
})

/**
 * @swagger
 * /v1/mcps/{server_id}:
 *   get:
 *     summary: Get MCP server info
 *     description: Get detailed information about a specific MCP server
 *     tags: [MCP]
 *     parameters:
 *       - in: path
 *         name: server_id
 *         required: true
 *         schema:
 *           type: string
 *         description: MCP server ID
 *     responses:
 *       200:
 *         description: MCP server information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/MCPServer'
 *       404:
 *         description: MCP server not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   $ref: '#/components/schemas/Error'
 */
router.get('/:server_id', async (req: Request, res: Response) => {
  try {
    logger.info('Get MCP server info request received')
    const server = await mcpApiService.getServerInfo(req.params.server_id)
    if (!server) {
      logger.warn('MCP server not found')
      return res.status(404).json({
        success: false,
        error: {
          message: 'MCP server not found',
          type: 'not_found',
          code: 'server_not_found'
        }
      })
    }
    return res.json({
      success: true,
      data: server
    })
  } catch (error: any) {
    logger.error('Error fetching MCP server info:', error)
    return res.status(503).json({
      success: false,
      error: {
        message: `Failed to retrieve MCP server info: ${error.message}`,
        type: 'service_unavailable',
        code: 'server_info_unavailable'
      }
    })
  }
})

// Connect to MCP server
router.all('/:server_id/mcp', async (req: Request, res: Response) => {
  const server = await mcpApiService.getServerById(req.params.server_id)
  if (!server) {
    logger.warn('MCP server not found')
    return res.status(404).json({
      success: false,
      error: {
        message: 'MCP server not found',
        type: 'not_found',
        code: 'server_not_found'
      }
    })
  }
  return await mcpApiService.handleRequest(req, res, server)
})

export { router as mcpRoutes }
