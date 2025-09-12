import express, { Request, Response } from 'express'
import { body, param, query, validationResult } from 'express-validator'

import { agentService } from '../../services/agents'
import { loggerService } from '../../services/LoggerService'

const logger = loggerService.withContext('ApiServerAgentsRoutes')

const router = express.Router()

// Validation middleware
const validateAgent = [
  body('name').notEmpty().withMessage('Name is required'),
  body('model').notEmpty().withMessage('Model is required'),
  body('description').optional().isString(),
  body('avatar').optional().isString(),
  body('instructions').optional().isString(),
  body('plan_model').optional().isString(),
  body('small_model').optional().isString(),
  body('built_in_tools').optional().isArray(),
  body('mcps').optional().isArray(),
  body('knowledges').optional().isArray(),
  body('configuration').optional().isObject(),
  body('accessible_paths').optional().isArray(),
  body('permission_mode').optional().isIn(['readOnly', 'acceptEdits', 'bypassPermissions']),
  body('max_steps').optional().isInt({ min: 1 })
]

const validateAgentUpdate = [
  body('name').optional().notEmpty().withMessage('Name cannot be empty'),
  body('model').optional().notEmpty().withMessage('Model cannot be empty'),
  body('description').optional().isString(),
  body('avatar').optional().isString(),
  body('instructions').optional().isString(),
  body('plan_model').optional().isString(),
  body('small_model').optional().isString(),
  body('built_in_tools').optional().isArray(),
  body('mcps').optional().isArray(),
  body('knowledges').optional().isArray(),
  body('configuration').optional().isObject(),
  body('accessible_paths').optional().isArray(),
  body('permission_mode').optional().isIn(['readOnly', 'acceptEdits', 'bypassPermissions']),
  body('max_steps').optional().isInt({ min: 1 })
]

const validateAgentId = [param('agentId').notEmpty().withMessage('Agent ID is required')]

const validatePagination = [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative')
]

// Error handler for validation
const handleValidationErrors = (req: Request, res: Response, next: any): void => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: {
        message: 'Validation failed',
        type: 'validation_error',
        details: errors.array()
      }
    })
    return
  }
  next()
}

/**
 * @swagger
 * components:
 *   schemas:
 *     AgentEntity:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique agent identifier
 *         name:
 *           type: string
 *           description: Agent name
 *         description:
 *           type: string
 *           description: Agent description
 *         avatar:
 *           type: string
 *           description: Agent avatar URL
 *         instructions:
 *           type: string
 *           description: System prompt/instructions
 *         model:
 *           type: string
 *           description: Main model ID
 *         plan_model:
 *           type: string
 *           description: Optional planning model ID
 *         small_model:
 *           type: string
 *           description: Optional small/fast model ID
 *         built_in_tools:
 *           type: array
 *           items:
 *             type: string
 *           description: Built-in tool IDs
 *         mcps:
 *           type: array
 *           items:
 *             type: string
 *           description: MCP tool IDs
 *         knowledges:
 *           type: array
 *           items:
 *             type: string
 *           description: Knowledge base IDs
 *         configuration:
 *           type: object
 *           description: Extensible settings
 *         accessible_paths:
 *           type: array
 *           items:
 *             type: string
 *           description: Accessible directory paths
 *         permission_mode:
 *           type: string
 *           enum: [readOnly, acceptEdits, bypassPermissions]
 *           description: Permission mode
 *         max_steps:
 *           type: integer
 *           description: Maximum steps the agent can take
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *       required:
 *         - id
 *         - name
 *         - model
 *         - created_at
 *         - updated_at
 *     CreateAgentRequest:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: Agent name
 *         description:
 *           type: string
 *           description: Agent description
 *         avatar:
 *           type: string
 *           description: Agent avatar URL
 *         instructions:
 *           type: string
 *           description: System prompt/instructions
 *         model:
 *           type: string
 *           description: Main model ID
 *         plan_model:
 *           type: string
 *           description: Optional planning model ID
 *         small_model:
 *           type: string
 *           description: Optional small/fast model ID
 *         built_in_tools:
 *           type: array
 *           items:
 *             type: string
 *           description: Built-in tool IDs
 *         mcps:
 *           type: array
 *           items:
 *             type: string
 *           description: MCP tool IDs
 *         knowledges:
 *           type: array
 *           items:
 *             type: string
 *           description: Knowledge base IDs
 *         configuration:
 *           type: object
 *           description: Extensible settings
 *         accessible_paths:
 *           type: array
 *           items:
 *             type: string
 *           description: Accessible directory paths
 *         permission_mode:
 *           type: string
 *           enum: [readOnly, acceptEdits, bypassPermissions]
 *           description: Permission mode
 *         max_steps:
 *           type: integer
 *           description: Maximum steps the agent can take
 *       required:
 *         - name
 *         - model
 */

/**
 * @swagger
 * /v1/agents:
 *   post:
 *     summary: Create a new agent
 *     description: Creates a new autonomous agent with the specified configuration
 *     tags: [Agents]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAgentRequest'
 *     responses:
 *       201:
 *         description: Agent created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentEntity'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', validateAgent, handleValidationErrors, async (req: Request, res: Response) => {
  try {
    logger.info('Creating new agent')
    logger.debug('Agent data:', req.body)

    const agent = await agentService.createAgent(req.body)

    logger.info(`Agent created successfully: ${agent.id}`)
    return res.status(201).json(agent)
  } catch (error: any) {
    logger.error('Error creating agent:', error)
    return res.status(500).json({
      error: {
        message: 'Failed to create agent',
        type: 'internal_error',
        code: 'agent_creation_failed'
      }
    })
  }
})

/**
 * @swagger
 * /v1/agents:
 *   get:
 *     summary: List all agents
 *     description: Retrieves a paginated list of all agents
 *     tags: [Agents]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of agents to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of agents to skip
 *     responses:
 *       200:
 *         description: List of agents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AgentEntity'
 *                 total:
 *                   type: integer
 *                   description: Total number of agents
 *                 limit:
 *                   type: integer
 *                   description: Number of agents returned
 *                 offset:
 *                   type: integer
 *                   description: Number of agents skipped
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', validatePagination, handleValidationErrors, async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0

    logger.info(`Listing agents with limit=${limit}, offset=${offset}`)

    const result = await agentService.listAgents({ limit, offset })

    logger.info(`Retrieved ${result.agents.length} agents (total: ${result.total})`)
    return res.json({
      data: result.agents,
      total: result.total,
      limit,
      offset
    })
  } catch (error: any) {
    logger.error('Error listing agents:', error)
    return res.status(500).json({
      error: {
        message: 'Failed to list agents',
        type: 'internal_error',
        code: 'agent_list_failed'
      }
    })
  }
})

/**
 * @swagger
 * /v1/agents/{agentId}:
 *   get:
 *     summary: Get agent by ID
 *     description: Retrieves a specific agent by its ID
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *     responses:
 *       200:
 *         description: Agent details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentEntity'
 *       404:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:agentId', validateAgentId, handleValidationErrors, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params
    logger.info(`Getting agent: ${agentId}`)

    const agent = await agentService.getAgent(agentId)

    if (!agent) {
      logger.warn(`Agent not found: ${agentId}`)
      return res.status(404).json({
        error: {
          message: 'Agent not found',
          type: 'not_found',
          code: 'agent_not_found'
        }
      })
    }

    logger.info(`Agent retrieved successfully: ${agentId}`)
    return res.json(agent)
  } catch (error: any) {
    logger.error('Error getting agent:', error)
    return res.status(500).json({
      error: {
        message: 'Failed to get agent',
        type: 'internal_error',
        code: 'agent_get_failed'
      }
    })
  }
})

/**
 * @swagger
 * /v1/agents/{agentId}:
 *   put:
 *     summary: Update agent
 *     description: Updates an existing agent with the provided data
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAgentRequest'
 *     responses:
 *       200:
 *         description: Agent updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentEntity'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put(
  '/:agentId',
  validateAgentId,
  validateAgentUpdate,
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { agentId } = req.params
      logger.info(`Updating agent: ${agentId}`)
      logger.debug('Update data:', req.body)

      const agent = await agentService.updateAgent(agentId, req.body)

      if (!agent) {
        logger.warn(`Agent not found for update: ${agentId}`)
        return res.status(404).json({
          error: {
            message: 'Agent not found',
            type: 'not_found',
            code: 'agent_not_found'
          }
        })
      }

      logger.info(`Agent updated successfully: ${agentId}`)
      return res.json(agent)
    } catch (error: any) {
      logger.error('Error updating agent:', error)
      return res.status(500).json({
        error: {
          message: 'Failed to update agent',
          type: 'internal_error',
          code: 'agent_update_failed'
        }
      })
    }
  }
)

/**
 * @swagger
 * /v1/agents/{agentId}:
 *   delete:
 *     summary: Delete agent
 *     description: Deletes an agent and all associated sessions and logs
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *     responses:
 *       204:
 *         description: Agent deleted successfully
 *       404:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/:agentId', validateAgentId, handleValidationErrors, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params
    logger.info(`Deleting agent: ${agentId}`)

    const deleted = await agentService.deleteAgent(agentId)

    if (!deleted) {
      logger.warn(`Agent not found for deletion: ${agentId}`)
      return res.status(404).json({
        error: {
          message: 'Agent not found',
          type: 'not_found',
          code: 'agent_not_found'
        }
      })
    }

    logger.info(`Agent deleted successfully: ${agentId}`)
    return res.status(204).send()
  } catch (error: any) {
    logger.error('Error deleting agent:', error)
    return res.status(500).json({
      error: {
        message: 'Failed to delete agent',
        type: 'internal_error',
        code: 'agent_delete_failed'
      }
    })
  }
})

// Mount session routes as nested resources
import { createSessionLogsRouter } from './session-logs'
import { createSessionsRouter } from './sessions'

const sessionsRouter = createSessionsRouter()
const sessionLogsRouter = createSessionLogsRouter()

// Mount nested routes
router.use('/:agentId/sessions', sessionsRouter)
router.use('/:agentId/sessions/:sessionId/logs', sessionLogsRouter)

export { router as agentsRoutes }
