import express, { Request, Response } from 'express'
import { body, param, query, validationResult } from 'express-validator'

import { agentService, sessionService } from '../../services/agents'
import { loggerService } from '../../services/LoggerService'

const logger = loggerService.withContext('ApiServerSessionsRoutes')

const router = express.Router()

// Validation middleware
const validateSession = [
  body('name').optional().isString(),
  body('sub_agent_ids').optional().isArray(),
  body('user_goal').optional().isString(),
  body('status').optional().isIn(['idle', 'running', 'completed', 'failed', 'stopped']),
  body('external_session_id').optional().isString(),
  body('model').optional().isString(),
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

const validateSessionUpdate = [
  body('name').optional().isString(),
  body('main_agent_id').optional().notEmpty().withMessage('Main agent ID cannot be empty'),
  body('sub_agent_ids').optional().isArray(),
  body('user_goal').optional().isString(),
  body('status').optional().isIn(['idle', 'running', 'completed', 'failed', 'stopped']),
  body('external_session_id').optional().isString(),
  body('model').optional().isString(),
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

const validateStatusUpdate = [
  body('status')
    .notEmpty()
    .isIn(['idle', 'running', 'completed', 'failed', 'stopped'])
    .withMessage('Valid status is required')
]

const validateAgentId = [param('agentId').notEmpty().withMessage('Agent ID is required')]

const validateSessionId = [param('sessionId').notEmpty().withMessage('Session ID is required')]

const validatePagination = [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
  query('status')
    .optional()
    .isIn(['idle', 'running', 'completed', 'failed', 'stopped'])
    .withMessage('Invalid status filter')
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

// Middleware to check if agent exists
const checkAgentExists = async (req: Request, res: Response, next: any): Promise<void> => {
  try {
    const { agentId } = req.params
    const exists = await agentService.agentExists(agentId)

    if (!exists) {
      res.status(404).json({
        error: {
          message: 'Agent not found',
          type: 'not_found',
          code: 'agent_not_found'
        }
      })
      return
    }

    next()
  } catch (error) {
    logger.error('Error checking agent existence:', error as Error)
    res.status(500).json({
      error: {
        message: 'Failed to validate agent',
        type: 'internal_error',
        code: 'agent_validation_failed'
      }
    })
  }
}

/**
 * @swagger
 * components:
 *   schemas:
 *     AgentSessionEntity:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique session identifier
 *         name:
 *           type: string
 *           description: Session name
 *         main_agent_id:
 *           type: string
 *           description: Primary agent ID
 *         sub_agent_ids:
 *           type: array
 *           items:
 *             type: string
 *           description: Sub-agent IDs
 *         user_goal:
 *           type: string
 *           description: Initial user goal
 *         status:
 *           type: string
 *           enum: [idle, running, completed, failed, stopped]
 *           description: Session status
 *         external_session_id:
 *           type: string
 *           description: External session tracking ID
 *         model:
 *           type: string
 *           description: Override model ID
 *         plan_model:
 *           type: string
 *           description: Override planning model ID
 *         small_model:
 *           type: string
 *           description: Override small/fast model ID
 *         built_in_tools:
 *           type: array
 *           items:
 *             type: string
 *           description: Override built-in tool IDs
 *         mcps:
 *           type: array
 *           items:
 *             type: string
 *           description: Override MCP tool IDs
 *         knowledges:
 *           type: array
 *           items:
 *             type: string
 *           description: Override knowledge base IDs
 *         configuration:
 *           type: object
 *           description: Override configuration settings
 *         accessible_paths:
 *           type: array
 *           items:
 *             type: string
 *           description: Override accessible directory paths
 *         permission_mode:
 *           type: string
 *           enum: [readOnly, acceptEdits, bypassPermissions]
 *           description: Override permission mode
 *         max_steps:
 *           type: integer
 *           description: Override maximum steps
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *       required:
 *         - id
 *         - main_agent_id
 *         - status
 *         - created_at
 *         - updated_at
 *     CreateSessionRequest:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: Session name
 *         sub_agent_ids:
 *           type: array
 *           items:
 *             type: string
 *           description: Sub-agent IDs
 *         user_goal:
 *           type: string
 *           description: Initial user goal
 *         status:
 *           type: string
 *           enum: [idle, running, completed, failed, stopped]
 *           description: Session status
 *         external_session_id:
 *           type: string
 *           description: External session tracking ID
 *         model:
 *           type: string
 *           description: Override model ID
 *         plan_model:
 *           type: string
 *           description: Override planning model ID
 *         small_model:
 *           type: string
 *           description: Override small/fast model ID
 *         built_in_tools:
 *           type: array
 *           items:
 *             type: string
 *           description: Override built-in tool IDs
 *         mcps:
 *           type: array
 *           items:
 *             type: string
 *           description: Override MCP tool IDs
 *         knowledges:
 *           type: array
 *           items:
 *             type: string
 *           description: Override knowledge base IDs
 *         configuration:
 *           type: object
 *           description: Override configuration settings
 *         accessible_paths:
 *           type: array
 *           items:
 *             type: string
 *           description: Override accessible directory paths
 *         permission_mode:
 *           type: string
 *           enum: [readOnly, acceptEdits, bypassPermissions]
 *           description: Override permission mode
 *         max_steps:
 *           type: integer
 *           description: Override maximum steps
 */

// Create nested session router
function createSessionsRouter(): express.Router {
  const sessionsRouter = express.Router({ mergeParams: true })

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions:
   *   post:
   *     summary: Create a new session for an agent
   *     description: Creates a new session for the specified agent
   *     tags: [Sessions]
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
   *             $ref: '#/components/schemas/CreateSessionRequest'
   *     responses:
   *       201:
   *         description: Session created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AgentSessionEntity'
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
  sessionsRouter.post(
    '/',
    validateAgentId,
    checkAgentExists,
    validateSession,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { agentId } = req.params
        const sessionData = { ...req.body, main_agent_id: agentId }

        logger.info(`Creating new session for agent: ${agentId}`)
        logger.debug('Session data:', sessionData)

        const session = await sessionService.createSession(sessionData)

        logger.info(`Session created successfully: ${session.id}`)
        return res.status(201).json(session)
      } catch (error: any) {
        logger.error('Error creating session:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to create session',
            type: 'internal_error',
            code: 'session_creation_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions:
   *   get:
   *     summary: List sessions for an agent
   *     description: Retrieves a paginated list of sessions for the specified agent
   *     tags: [Sessions]
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 20
   *         description: Number of sessions to return
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           minimum: 0
   *           default: 0
   *         description: Number of sessions to skip
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [idle, running, completed, failed, stopped]
   *         description: Filter by session status
   *     responses:
   *       200:
   *         description: List of sessions
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/AgentSessionEntity'
   *                 total:
   *                   type: integer
   *                   description: Total number of sessions
   *                 limit:
   *                   type: integer
   *                   description: Number of sessions returned
   *                 offset:
   *                   type: integer
   *                   description: Number of sessions skipped
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
  sessionsRouter.get(
    '/',
    validateAgentId,
    checkAgentExists,
    validatePagination,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { agentId } = req.params
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 20
        const offset = req.query.offset ? parseInt(req.query.offset as string) : 0
        const status = req.query.status as any

        logger.info(`Listing sessions for agent: ${agentId} with limit=${limit}, offset=${offset}, status=${status}`)

        const result = await sessionService.listSessions(agentId, { limit, offset, status })

        logger.info(`Retrieved ${result.sessions.length} sessions (total: ${result.total}) for agent: ${agentId}`)
        return res.json({
          data: result.sessions,
          total: result.total,
          limit,
          offset
        })
      } catch (error: any) {
        logger.error('Error listing sessions:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to list sessions',
            type: 'internal_error',
            code: 'session_list_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}:
   *   get:
   *     summary: Get session by ID
   *     description: Retrieves a specific session for the specified agent
   *     tags: [Sessions]
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *     responses:
   *       200:
   *         description: Session details
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AgentSessionEntity'
   *       404:
   *         description: Agent or session not found
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
  sessionsRouter.get(
    '/:sessionId',
    validateAgentId,
    validateSessionId,
    checkAgentExists,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { agentId, sessionId } = req.params
        logger.info(`Getting session: ${sessionId} for agent: ${agentId}`)

        const session = await sessionService.getSession(sessionId)

        if (!session) {
          logger.warn(`Session not found: ${sessionId}`)
          return res.status(404).json({
            error: {
              message: 'Session not found',
              type: 'not_found',
              code: 'session_not_found'
            }
          })
        }

        // Verify session belongs to the agent
        if (session.main_agent_id !== agentId) {
          logger.warn(`Session ${sessionId} does not belong to agent ${agentId}`)
          return res.status(404).json({
            error: {
              message: 'Session not found for this agent',
              type: 'not_found',
              code: 'session_not_found'
            }
          })
        }

        logger.info(`Session retrieved successfully: ${sessionId}`)
        return res.json(session)
      } catch (error: any) {
        logger.error('Error getting session:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to get session',
            type: 'internal_error',
            code: 'session_get_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}:
   *   put:
   *     summary: Replace session
   *     description: Completely replaces an existing session for the specified agent
   *     tags: [Sessions]
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateSessionRequest'
   *     responses:
   *       200:
   *         description: Session replaced successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AgentSessionEntity'
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Agent or session not found
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
  sessionsRouter.put(
    '/:sessionId',
    validateAgentId,
    validateSessionId,
    checkAgentExists,
    validateSessionUpdate,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { agentId, sessionId } = req.params
        logger.info(`Replacing session: ${sessionId} for agent: ${agentId}`)
        logger.debug('Replace data:', req.body)

        // First check if session exists and belongs to agent
        const existingSession = await sessionService.getSession(sessionId)
        if (!existingSession || existingSession.main_agent_id !== agentId) {
          logger.warn(`Session ${sessionId} not found for agent ${agentId}`)
          return res.status(404).json({
            error: {
              message: 'Session not found for this agent',
              type: 'not_found',
              code: 'session_not_found'
            }
          })
        }

        // For PUT, we replace the entire resource
        const sessionData = { ...req.body, main_agent_id: agentId }
        const session = await sessionService.updateSession(sessionId, sessionData)

        if (!session) {
          logger.warn(`Session not found for replace: ${sessionId}`)
          return res.status(404).json({
            error: {
              message: 'Session not found',
              type: 'not_found',
              code: 'session_not_found'
            }
          })
        }

        logger.info(`Session replaced successfully: ${sessionId}`)
        return res.json(session)
      } catch (error: any) {
        logger.error('Error replacing session:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to replace session',
            type: 'internal_error',
            code: 'session_replace_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}:
   *   patch:
   *     summary: Update session
   *     description: Updates an existing session for the specified agent
   *     tags: [Sessions]
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateSessionRequest'
   *     responses:
   *       200:
   *         description: Session updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AgentSessionEntity'
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Agent or session not found
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
  sessionsRouter.patch(
    '/:sessionId',
    validateAgentId,
    validateSessionId,
    checkAgentExists,
    validateSessionUpdate,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { agentId, sessionId } = req.params
        logger.info(`Updating session: ${sessionId} for agent: ${agentId}`)
        logger.debug('Update data:', req.body)

        // First check if session exists and belongs to agent
        const existingSession = await sessionService.getSession(sessionId)
        if (!existingSession || existingSession.main_agent_id !== agentId) {
          logger.warn(`Session ${sessionId} not found for agent ${agentId}`)
          return res.status(404).json({
            error: {
              message: 'Session not found for this agent',
              type: 'not_found',
              code: 'session_not_found'
            }
          })
        }
        const updateSession = { ...existingSession, ...req.body }
        const session = await sessionService.updateSession(sessionId, updateSession)

        if (!session) {
          logger.warn(`Session not found for update: ${sessionId}`)
          return res.status(404).json({
            error: {
              message: 'Session not found',
              type: 'not_found',
              code: 'session_not_found'
            }
          })
        }

        logger.info(`Session updated successfully: ${sessionId}`)
        return res.json(session)
      } catch (error: any) {
        logger.error('Error updating session:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to update session',
            type: 'internal_error',
            code: 'session_update_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}:
   *   delete:
   *     summary: Delete session
   *     description: Deletes a session and all associated logs
   *     tags: [Sessions]
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *     responses:
   *       204:
   *         description: Session deleted successfully
   *       404:
   *         description: Agent or session not found
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
  sessionsRouter.delete(
    '/:sessionId',
    validateAgentId,
    validateSessionId,
    checkAgentExists,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { agentId, sessionId } = req.params
        logger.info(`Deleting session: ${sessionId} for agent: ${agentId}`)

        // First check if session exists and belongs to agent
        const existingSession = await sessionService.getSession(sessionId)
        if (!existingSession || existingSession.main_agent_id !== agentId) {
          logger.warn(`Session ${sessionId} not found for agent ${agentId}`)
          return res.status(404).json({
            error: {
              message: 'Session not found for this agent',
              type: 'not_found',
              code: 'session_not_found'
            }
          })
        }

        const deleted = await sessionService.deleteSession(sessionId)

        if (!deleted) {
          logger.warn(`Session not found for deletion: ${sessionId}`)
          return res.status(404).json({
            error: {
              message: 'Session not found',
              type: 'not_found',
              code: 'session_not_found'
            }
          })
        }

        logger.info(`Session deleted successfully: ${sessionId}`)
        return res.status(204).send()
      } catch (error: any) {
        logger.error('Error deleting session:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to delete session',
            type: 'internal_error',
            code: 'session_delete_failed'
          }
        })
      }
    }
  )

  return sessionsRouter
}

// Convenience routes (standalone sessions without agent context)
/**
 * @swagger
 * /v1/sessions:
 *   get:
 *     summary: List all sessions
 *     description: Retrieves a paginated list of all sessions across all agents
 *     tags: [Sessions]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of sessions to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of sessions to skip
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [idle, running, completed, failed, stopped]
 *         description: Filter by session status
 *     responses:
 *       200:
 *         description: List of sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AgentSessionEntity'
 *                 total:
 *                   type: integer
 *                   description: Total number of sessions
 *                 limit:
 *                   type: integer
 *                   description: Number of sessions returned
 *                 offset:
 *                   type: integer
 *                   description: Number of sessions skipped
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
    const status = req.query.status as any

    logger.info(`Listing all sessions with limit=${limit}, offset=${offset}, status=${status}`)

    const result = await sessionService.listSessions(undefined, { limit, offset, status })

    logger.info(`Retrieved ${result.sessions.length} sessions (total: ${result.total})`)
    return res.json({
      data: result.sessions,
      total: result.total,
      limit,
      offset
    })
  } catch (error: any) {
    logger.error('Error listing all sessions:', error)
    return res.status(500).json({
      error: {
        message: 'Failed to list sessions',
        type: 'internal_error',
        code: 'session_list_failed'
      }
    })
  }
})

/**
 * @swagger
 * /v1/sessions/{sessionId}:
 *   get:
 *     summary: Get session by ID (convenience endpoint)
 *     description: Retrieves a specific session without requiring agent context
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Session details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AgentSessionEntity'
 *       404:
 *         description: Session not found
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
router.get('/:sessionId', validateSessionId, handleValidationErrors, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params
    logger.info(`Getting session: ${sessionId}`)

    const session = await sessionService.getSession(sessionId)

    if (!session) {
      logger.warn(`Session not found: ${sessionId}`)
      return res.status(404).json({
        error: {
          message: 'Session not found',
          type: 'not_found',
          code: 'session_not_found'
        }
      })
    }

    logger.info(`Session retrieved successfully: ${sessionId}`)
    return res.json(session)
  } catch (error: any) {
    logger.error('Error getting session:', error)
    return res.status(500).json({
      error: {
        message: 'Failed to get session',
        type: 'internal_error',
        code: 'session_get_failed'
      }
    })
  }
})

export { createSessionsRouter, router as sessionsRoutes }
