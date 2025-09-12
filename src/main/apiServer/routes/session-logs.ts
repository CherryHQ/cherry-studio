import express, { Request, Response } from 'express'
import { body, param, query, validationResult } from 'express-validator'

import { agentService } from '../../services/agents/AgentService'
import { sessionLogService } from '../../services/agents/SessionLogService'
import { sessionService } from '../../services/agents/SessionService'
import { loggerService } from '../../services/LoggerService'

const logger = loggerService.withContext('ApiServerSessionLogsRoutes')

const router = express.Router()

// Validation middleware
const validateSessionLog = [
  body('parent_id').optional().isInt({ min: 1 }).withMessage('Parent ID must be a positive integer'),
  body('role').notEmpty().isIn(['user', 'agent', 'system', 'tool']).withMessage('Valid role is required'),
  body('type').notEmpty().isString().withMessage('Type is required'),
  body('content').notEmpty().isObject().withMessage('Content must be a valid object'),
  body('metadata').optional().isObject().withMessage('Metadata must be a valid object')
]

const validateSessionLogUpdate = [
  body('content').optional().isObject().withMessage('Content must be a valid object'),
  body('metadata').optional().isObject().withMessage('Metadata must be a valid object')
]

const validateBulkSessionLogs = [
  body().isArray().withMessage('Request body must be an array'),
  body('*.parent_id').optional().isInt({ min: 1 }).withMessage('Parent ID must be a positive integer'),
  body('*.role').notEmpty().isIn(['user', 'agent', 'system', 'tool']).withMessage('Valid role is required'),
  body('*.type').notEmpty().isString().withMessage('Type is required'),
  body('*.content').notEmpty().isObject().withMessage('Content must be a valid object'),
  body('*.metadata').optional().isObject().withMessage('Metadata must be a valid object')
]

const validateAgentId = [param('agentId').notEmpty().withMessage('Agent ID is required')]

const validateSessionId = [param('sessionId').notEmpty().withMessage('Session ID is required')]

const validateLogId = [param('logId').isInt({ min: 1 }).withMessage('Log ID must be a positive integer')]

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

// Middleware to check if agent and session exist
const checkAgentAndSessionExist = async (req: Request, res: Response, next: any): Promise<void> => {
  try {
    const { agentId, sessionId } = req.params

    const agentExists = await agentService.agentExists(agentId)
    if (!agentExists) {
      res.status(404).json({
        error: {
          message: 'Agent not found',
          type: 'not_found',
          code: 'agent_not_found'
        }
      })
      return
    }

    const session = await sessionService.getSession(sessionId)
    if (!session) {
      res.status(404).json({
        error: {
          message: 'Session not found',
          type: 'not_found',
          code: 'session_not_found'
        }
      })
      return
    }

    // Verify session belongs to the agent
    if (session.main_agent_id !== agentId) {
      res.status(404).json({
        error: {
          message: 'Session not found for this agent',
          type: 'not_found',
          code: 'session_not_found'
        }
      })
      return
    }

    next()
  } catch (error) {
    logger.error('Error checking agent and session existence:', error as Error)
    res.status(500).json({
      error: {
        message: 'Failed to validate agent and session',
        type: 'internal_error',
        code: 'validation_failed'
      }
    })
  }
}

/**
 * @swagger
 * components:
 *   schemas:
 *     SessionLogEntity:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Unique log entry identifier
 *         session_id:
 *           type: string
 *           description: Reference to session
 *         parent_id:
 *           type: integer
 *           description: Parent log entry ID for tree structure
 *         role:
 *           type: string
 *           enum: [user, agent, system, tool]
 *           description: Role that created the log entry
 *         type:
 *           type: string
 *           description: Type of log entry
 *         content:
 *           type: object
 *           description: JSON structured log data
 *         metadata:
 *           type: object
 *           description: Additional metadata
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *       required:
 *         - id
 *         - session_id
 *         - role
 *         - type
 *         - content
 *         - created_at
 *         - updated_at
 *     CreateSessionLogRequest:
 *       type: object
 *       properties:
 *         parent_id:
 *           type: integer
 *           description: Parent log entry ID for tree structure
 *         role:
 *           type: string
 *           enum: [user, agent, system, tool]
 *           description: Role that created the log entry
 *         type:
 *           type: string
 *           description: Type of log entry
 *         content:
 *           type: object
 *           description: JSON structured log data
 *         metadata:
 *           type: object
 *           description: Additional metadata
 *       required:
 *         - role
 *         - type
 *         - content
 */

// Create nested session logs router
function createSessionLogsRouter(): express.Router {
  const sessionLogsRouter = express.Router({ mergeParams: true })

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}/logs:
   *   post:
   *     summary: Create a new log entry for a session
   *     description: Creates a new log entry for the specified session
   *     tags: [Session Logs]
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
   *             $ref: '#/components/schemas/CreateSessionLogRequest'
   *     responses:
   *       201:
   *         description: Log entry created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SessionLogEntity'
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
  sessionLogsRouter.post(
    '/',
    validateAgentId,
    validateSessionId,
    checkAgentAndSessionExist,
    validateSessionLog,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { sessionId } = req.params
        const logData = { ...req.body, session_id: sessionId }

        logger.info(`Creating new log entry for session: ${sessionId}`)
        logger.debug('Log data:', logData)

        const log = await sessionLogService.createSessionLog(logData)

        logger.info(`Log entry created successfully: ${log.id}`)
        return res.status(201).json(log)
      } catch (error: any) {
        logger.error('Error creating session log:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to create log entry',
            type: 'internal_error',
            code: 'log_creation_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}/logs/bulk:
   *   post:
   *     summary: Create multiple log entries for a session
   *     description: Creates multiple log entries for the specified session in a single request
   *     tags: [Session Logs]
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
   *             type: array
   *             items:
   *               $ref: '#/components/schemas/CreateSessionLogRequest'
   *     responses:
   *       201:
   *         description: Log entries created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/SessionLogEntity'
   *                 count:
   *                   type: integer
   *                   description: Number of log entries created
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
  sessionLogsRouter.post(
    '/bulk',
    validateAgentId,
    validateSessionId,
    checkAgentAndSessionExist,
    validateBulkSessionLogs,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { sessionId } = req.params
        const logsData = req.body.map((logData: any) => ({ ...logData, session_id: sessionId }))

        logger.info(`Creating ${logsData.length} log entries for session: ${sessionId}`)

        const logs = await sessionLogService.bulkCreateSessionLogs(logsData)

        logger.info(`${logs.length} log entries created successfully for session: ${sessionId}`)
        return res.status(201).json({
          data: logs,
          count: logs.length
        })
      } catch (error: any) {
        logger.error('Error creating bulk session logs:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to create log entries',
            type: 'internal_error',
            code: 'bulk_log_creation_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}/logs:
   *   get:
   *     summary: List log entries for a session
   *     description: Retrieves a paginated list of log entries for the specified session
   *     tags: [Session Logs]
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
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 50
   *         description: Number of log entries to return
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           minimum: 0
   *           default: 0
   *         description: Number of log entries to skip
   *     responses:
   *       200:
   *         description: List of log entries
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/SessionLogEntity'
   *                 total:
   *                   type: integer
   *                   description: Total number of log entries
   *                 limit:
   *                   type: integer
   *                   description: Number of log entries returned
   *                 offset:
   *                   type: integer
   *                   description: Number of log entries skipped
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
  sessionLogsRouter.get(
    '/',
    validateAgentId,
    validateSessionId,
    checkAgentAndSessionExist,
    validatePagination,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { sessionId } = req.params
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50
        const offset = req.query.offset ? parseInt(req.query.offset as string) : 0

        logger.info(`Listing logs for session: ${sessionId} with limit=${limit}, offset=${offset}`)

        const result = await sessionLogService.listSessionLogs(sessionId, { limit, offset })

        logger.info(`Retrieved ${result.logs.length} logs (total: ${result.total}) for session: ${sessionId}`)
        return res.json({
          data: result.logs,
          total: result.total,
          limit,
          offset
        })
      } catch (error: any) {
        logger.error('Error listing session logs:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to list log entries',
            type: 'internal_error',
            code: 'log_list_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}/logs/{logId}:
   *   get:
   *     summary: Get log entry by ID
   *     description: Retrieves a specific log entry for the specified session
   *     tags: [Session Logs]
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
   *       - in: path
   *         name: logId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Log entry ID
   *     responses:
   *       200:
   *         description: Log entry details
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SessionLogEntity'
   *       404:
   *         description: Agent, session, or log entry not found
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
  sessionLogsRouter.get(
    '/:logId',
    validateAgentId,
    validateSessionId,
    validateLogId,
    checkAgentAndSessionExist,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { sessionId, logId } = req.params
        const logIdNum = parseInt(logId)

        logger.info(`Getting log entry: ${logId} for session: ${sessionId}`)

        const log = await sessionLogService.getSessionLog(logIdNum)

        if (!log) {
          logger.warn(`Log entry not found: ${logId}`)
          return res.status(404).json({
            error: {
              message: 'Log entry not found',
              type: 'not_found',
              code: 'log_not_found'
            }
          })
        }

        // Verify log belongs to the session
        if (log.session_id !== sessionId) {
          logger.warn(`Log entry ${logId} does not belong to session ${sessionId}`)
          return res.status(404).json({
            error: {
              message: 'Log entry not found for this session',
              type: 'not_found',
              code: 'log_not_found'
            }
          })
        }

        logger.info(`Log entry retrieved successfully: ${logId}`)
        return res.json(log)
      } catch (error: any) {
        logger.error('Error getting session log:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to get log entry',
            type: 'internal_error',
            code: 'log_get_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}/logs/{logId}:
   *   put:
   *     summary: Update log entry
   *     description: Updates an existing log entry for the specified session
   *     tags: [Session Logs]
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
   *       - in: path
   *         name: logId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Log entry ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               content:
   *                 type: object
   *                 description: Updated log content
   *               metadata:
   *                 type: object
   *                 description: Updated metadata
   *     responses:
   *       200:
   *         description: Log entry updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SessionLogEntity'
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Agent, session, or log entry not found
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
  sessionLogsRouter.put(
    '/:logId',
    validateAgentId,
    validateSessionId,
    validateLogId,
    checkAgentAndSessionExist,
    validateSessionLogUpdate,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { sessionId, logId } = req.params
        const logIdNum = parseInt(logId)

        logger.info(`Updating log entry: ${logId} for session: ${sessionId}`)
        logger.debug('Update data:', req.body)

        // First check if log exists and belongs to session
        const existingLog = await sessionLogService.getSessionLog(logIdNum)
        if (!existingLog || existingLog.session_id !== sessionId) {
          logger.warn(`Log entry ${logId} not found for session ${sessionId}`)
          return res.status(404).json({
            error: {
              message: 'Log entry not found for this session',
              type: 'not_found',
              code: 'log_not_found'
            }
          })
        }

        const log = await sessionLogService.updateSessionLog(logIdNum, req.body)

        if (!log) {
          logger.warn(`Log entry not found for update: ${logId}`)
          return res.status(404).json({
            error: {
              message: 'Log entry not found',
              type: 'not_found',
              code: 'log_not_found'
            }
          })
        }

        logger.info(`Log entry updated successfully: ${logId}`)
        return res.json(log)
      } catch (error: any) {
        logger.error('Error updating session log:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to update log entry',
            type: 'internal_error',
            code: 'log_update_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}/logs/{logId}:
   *   delete:
   *     summary: Delete log entry
   *     description: Deletes a specific log entry
   *     tags: [Session Logs]
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
   *       - in: path
   *         name: logId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Log entry ID
   *     responses:
   *       204:
   *         description: Log entry deleted successfully
   *       404:
   *         description: Agent, session, or log entry not found
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
  sessionLogsRouter.delete(
    '/:logId',
    validateAgentId,
    validateSessionId,
    validateLogId,
    checkAgentAndSessionExist,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { sessionId, logId } = req.params
        const logIdNum = parseInt(logId)

        logger.info(`Deleting log entry: ${logId} for session: ${sessionId}`)

        // First check if log exists and belongs to session
        const existingLog = await sessionLogService.getSessionLog(logIdNum)
        if (!existingLog || existingLog.session_id !== sessionId) {
          logger.warn(`Log entry ${logId} not found for session ${sessionId}`)
          return res.status(404).json({
            error: {
              message: 'Log entry not found for this session',
              type: 'not_found',
              code: 'log_not_found'
            }
          })
        }

        const deleted = await sessionLogService.deleteSessionLog(logIdNum)

        if (!deleted) {
          logger.warn(`Log entry not found for deletion: ${logId}`)
          return res.status(404).json({
            error: {
              message: 'Log entry not found',
              type: 'not_found',
              code: 'log_not_found'
            }
          })
        }

        logger.info(`Log entry deleted successfully: ${logId}`)
        return res.status(204).send()
      } catch (error: any) {
        logger.error('Error deleting session log:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to delete log entry',
            type: 'internal_error',
            code: 'log_delete_failed'
          }
        })
      }
    }
  )

  return sessionLogsRouter
}

// Convenience routes (standalone session logs without agent context)
/**
 * @swagger
 * /v1/sessions/{sessionId}/logs:
 *   get:
 *     summary: List log entries for a session (convenience endpoint)
 *     description: Retrieves a paginated list of log entries for the specified session without requiring agent context
 *     tags: [Session Logs]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Number of log entries to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of log entries to skip
 *     responses:
 *       200:
 *         description: List of log entries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SessionLogEntity'
 *                 total:
 *                   type: integer
 *                   description: Total number of log entries
 *                 limit:
 *                   type: integer
 *                   description: Number of log entries returned
 *                 offset:
 *                   type: integer
 *                   description: Number of log entries skipped
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
router.get(
  '/:sessionId/logs',
  validateSessionId,
  validatePagination,
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0

      // Check if session exists
      const sessionExists = await sessionService.sessionExists(sessionId)
      if (!sessionExists) {
        return res.status(404).json({
          error: {
            message: 'Session not found',
            type: 'not_found',
            code: 'session_not_found'
          }
        })
      }

      logger.info(`Listing logs for session: ${sessionId} with limit=${limit}, offset=${offset}`)

      const result = await sessionLogService.listSessionLogs(sessionId, { limit, offset })

      logger.info(`Retrieved ${result.logs.length} logs (total: ${result.total}) for session: ${sessionId}`)
      return res.json({
        data: result.logs,
        total: result.total,
        limit,
        offset
      })
    } catch (error: any) {
      logger.error('Error listing session logs:', error)
      return res.status(500).json({
        error: {
          message: 'Failed to list log entries',
          type: 'internal_error',
          code: 'log_list_failed'
        }
      })
    }
  }
)

/**
 * @swagger
 * /v1/session-logs/{logId}:
 *   get:
 *     summary: Get log entry by ID (convenience endpoint)
 *     description: Retrieves a specific log entry without requiring agent or session context
 *     tags: [Session Logs]
 *     parameters:
 *       - in: path
 *         name: logId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Log entry ID
 *     responses:
 *       200:
 *         description: Log entry details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionLogEntity'
 *       404:
 *         description: Log entry not found
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
router.get('/session-logs/:logId', validateLogId, handleValidationErrors, async (req: Request, res: Response) => {
  try {
    const { logId } = req.params
    const logIdNum = parseInt(logId)

    logger.info(`Getting log entry: ${logId}`)

    const log = await sessionLogService.getSessionLog(logIdNum)

    if (!log) {
      logger.warn(`Log entry not found: ${logId}`)
      return res.status(404).json({
        error: {
          message: 'Log entry not found',
          type: 'not_found',
          code: 'log_not_found'
        }
      })
    }

    logger.info(`Log entry retrieved successfully: ${logId}`)
    return res.json(log)
  } catch (error: any) {
    logger.error('Error getting session log:', error)
    return res.status(500).json({
      error: {
        message: 'Failed to get log entry',
        type: 'internal_error',
        code: 'log_get_failed'
      }
    })
  }
})

export { createSessionLogsRouter, router as sessionLogsRoutes }
