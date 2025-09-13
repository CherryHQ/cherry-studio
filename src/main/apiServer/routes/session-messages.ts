import express, { Request, Response } from 'express'
import { body, param, query, validationResult } from 'express-validator'

import { agentService, sessionMessageService, sessionService } from '../../services/agents'
import { loggerService } from '../../services/LoggerService'

const logger = loggerService.withContext('ApiServerSessionMessagesRoutes')

const router = express.Router()

// Validation middleware
const validateSessionMessage = [
  body('parent_id').optional().isInt({ min: 1 }).withMessage('Parent ID must be a positive integer'),
  body('role').notEmpty().isIn(['user', 'agent', 'system', 'tool']).withMessage('Valid role is required'),
  body('type').notEmpty().isString().withMessage('Type is required'),
  body('content').notEmpty().isObject().withMessage('Content must be a valid object'),
  body('metadata').optional().isObject().withMessage('Metadata must be a valid object')
]

const validateSessionMessageUpdate = [
  body('content').optional().isObject().withMessage('Content must be a valid object'),
  body('metadata').optional().isObject().withMessage('Metadata must be a valid object')
]

const validateBulkSessionMessages = [
  body().isArray().withMessage('Request body must be an array'),
  body('*.parent_id').optional().isInt({ min: 1 }).withMessage('Parent ID must be a positive integer'),
  body('*.role').notEmpty().isIn(['user', 'agent', 'system', 'tool']).withMessage('Valid role is required'),
  body('*.type').notEmpty().isString().withMessage('Type is required'),
  body('*.content').notEmpty().isObject().withMessage('Content must be a valid object'),
  body('*.metadata').optional().isObject().withMessage('Metadata must be a valid object')
]

const validateAgentId = [param('agentId').notEmpty().withMessage('Agent ID is required')]

const validateSessionId = [param('sessionId').notEmpty().withMessage('Session ID is required')]

const validateMessageId = [param('messageId').isInt({ min: 1 }).withMessage('Message ID must be a positive integer')]

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
 *     SessionMessageEntity:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Unique message entry identifier
 *         session_id:
 *           type: string
 *           description: Reference to session
 *         parent_id:
 *           type: integer
 *           description: Parent message entry ID for tree structure
 *         role:
 *           type: string
 *           enum: [user, agent, system, tool]
 *           description: Role that created the message entry
 *         type:
 *           type: string
 *           description: Type of message entry
 *         content:
 *           type: object
 *           description: JSON structured message data
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
 *     CreateSessionMessageRequest:
 *       type: object
 *       properties:
 *         parent_id:
 *           type: integer
 *           description: Parent message entry ID for tree structure
 *         role:
 *           type: string
 *           enum: [user, agent, system, tool]
 *           description: Role that created the message entry
 *         type:
 *           type: string
 *           description: Type of message entry
 *         content:
 *           type: object
 *           description: JSON structured message data
 *         metadata:
 *           type: object
 *           description: Additional metadata
 *       required:
 *         - role
 *         - type
 *         - content
 */

// Create nested session messages router
function createSessionMessagesRouter(): express.Router {
  const sessionMessagesRouter = express.Router({ mergeParams: true })

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}/messages:
   *   post:
   *     summary: Create a new message entry for a session
   *     description: Creates a new message entry for the specified session
   *     tags: [Session Messages]
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
   *             $ref: '#/components/schemas/CreateSessionMessageRequest'
   *     responses:
   *       201:
   *         description: Log entry created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SessionMessageEntity'
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
  sessionMessagesRouter.post(
    '/',
    validateAgentId,
    validateSessionId,
    checkAgentAndSessionExist,
    validateSessionMessage,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { sessionId } = req.params
        const messageData = { ...req.body, session_id: sessionId }

        logger.info(`Creating new message entry for session: ${sessionId}`)
        logger.debug('Message data:', messageData)

        const message = await sessionMessageService.createSessionMessage(messageData)

        logger.info(`Message entry created successfully: ${message.id}`)
        return res.status(201).json(message)
      } catch (error: any) {
        logger.error('Error creating session message:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to create message entry',
            type: 'internal_error',
            code: 'message_creation_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}/messages/bulk:
   *   post:
   *     summary: Create multiple message entries for a session
   *     description: Creates multiple message entries for the specified session in a single request
   *     tags: [Session Messages]
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
   *               $ref: '#/components/schemas/CreateSessionMessageRequest'
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
   *                     $ref: '#/components/schemas/SessionMessageEntity'
   *                 count:
   *                   type: integer
   *                   description: Number of message entries created
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
  sessionMessagesRouter.post(
    '/bulk',
    validateAgentId,
    validateSessionId,
    checkAgentAndSessionExist,
    validateBulkSessionMessages,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { sessionId } = req.params
        const messagesData = req.body.map((messageData: any) => ({ ...messageData, session_id: sessionId }))

        logger.info(`Creating ${messagesData.length} message entries for session: ${sessionId}`)

        const messages = await sessionMessageService.bulkCreateSessionMessages(messagesData)

        logger.info(`${messages.length} message entries created successfully for session: ${sessionId}`)
        return res.status(201).json({
          data: messages,
          count: messages.length
        })
      } catch (error: any) {
        logger.error('Error creating bulk session messages:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to create message entries',
            type: 'internal_error',
            code: 'bulk_message_creation_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}/messages:
   *   get:
   *     summary: List message entries for a session
   *     description: Retrieves a paginated list of message entries for the specified session
   *     tags: [Session Messages]
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
   *         description: Number of message entries to return
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           minimum: 0
   *           default: 0
   *         description: Number of message entries to skip
   *     responses:
   *       200:
   *         description: List of message entries
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/SessionMessageEntity'
   *                 total:
   *                   type: integer
   *                   description: Total number of message entries
   *                 limit:
   *                   type: integer
   *                   description: Number of message entries returned
   *                 offset:
   *                   type: integer
   *                   description: Number of message entries skipped
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
  sessionMessagesRouter.get(
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

        logger.info(`Listing messages for session: ${sessionId} with limit=${limit}, offset=${offset}`)

        const result = await sessionMessageService.listSessionMessages(sessionId, { limit, offset })

        logger.info(`Retrieved ${result.messages.length} messages (total: ${result.total}) for session: ${sessionId}`)
        return res.json({
          data: result.messages,
          total: result.total,
          limit,
          offset
        })
      } catch (error: any) {
        logger.error('Error listing session messages:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to list message entries',
            type: 'internal_error',
            code: 'message_list_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}/messages/{messageId}:
   *   get:
   *     summary: Get message entry by ID
   *     description: Retrieves a specific message entry for the specified session
   *     tags: [Session Messages]
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
   *         name: messageId
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
   *               $ref: '#/components/schemas/SessionMessageEntity'
   *       404:
   *         description: Agent, session, or message entry not found
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
  sessionMessagesRouter.get(
    '/:messageId',
    validateAgentId,
    validateSessionId,
    validateMessageId,
    checkAgentAndSessionExist,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { sessionId, messageId } = req.params
        const messageIdNum = parseInt(messageId)

        logger.info(`Getting message entry: ${messageId} for session: ${sessionId}`)

        const message = await sessionMessageService.getSessionMessage(messageIdNum)

        if (!message) {
          logger.warn(`Message entry not found: ${messageId}`)
          return res.status(404).json({
            error: {
              message: 'Message entry not found',
              type: 'not_found',
              code: 'message_not_found'
            }
          })
        }

        // Verify message belongs to the session
        if (message.session_id !== sessionId) {
          logger.warn(`Message entry ${messageId} does not belong to session ${sessionId}`)
          return res.status(404).json({
            error: {
              message: 'Message entry not found for this session',
              type: 'not_found',
              code: 'message_not_found'
            }
          })
        }

        logger.info(`Message entry retrieved successfully: ${messageId}`)
        return res.json(message)
      } catch (error: any) {
        logger.error('Error getting session message:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to get message entry',
            type: 'internal_error',
            code: 'message_get_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}/messages/{messageId}:
   *   put:
   *     summary: Update message entry
   *     description: Updates an existing message entry for the specified session
   *     tags: [Session Messages]
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
   *         name: messageId
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
   *                 description: Updated message content
   *               metadata:
   *                 type: object
   *                 description: Updated metadata
   *     responses:
   *       200:
   *         description: Log entry updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SessionMessageEntity'
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Agent, session, or message entry not found
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
  sessionMessagesRouter.put(
    '/:messageId',
    validateAgentId,
    validateSessionId,
    validateMessageId,
    checkAgentAndSessionExist,
    validateSessionMessageUpdate,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { sessionId, messageId } = req.params
        const messageIdNum = parseInt(messageId)

        logger.info(`Updating message entry: ${messageId} for session: ${sessionId}`)
        logger.debug('Update data:', req.body)

        // First check if log exists and belongs to session
        const existingMessage = await sessionMessageService.getSessionMessage(messageIdNum)
        if (!existingMessage || existingMessage.session_id !== sessionId) {
          logger.warn(`Log entry ${messageId} not found for session ${sessionId}`)
          return res.status(404).json({
            error: {
              message: 'Message entry not found for this session',
              type: 'not_found',
              code: 'message_not_found'
            }
          })
        }

        const message = await sessionMessageService.updateSessionMessage(messageIdNum, req.body)

        if (!message) {
          logger.warn(`Log entry not found for update: ${messageId}`)
          return res.status(404).json({
            error: {
              message: 'Message entry not found',
              type: 'not_found',
              code: 'message_not_found'
            }
          })
        }

        logger.info(`Log entry updated successfully: ${messageId}`)
        return res.json(message)
      } catch (error: any) {
        logger.error('Error updating session message:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to update message entry',
            type: 'internal_error',
            code: 'message_update_failed'
          }
        })
      }
    }
  )

  /**
   * @swagger
   * /v1/agents/{agentId}/sessions/{sessionId}/messages/{messageId}:
   *   delete:
   *     summary: Delete message entry
   *     description: Deletes a specific message entry
   *     tags: [Session Messages]
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
   *         name: messageId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Log entry ID
   *     responses:
   *       204:
   *         description: Log entry deleted successfully
   *       404:
   *         description: Agent, session, or message entry not found
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
  sessionMessagesRouter.delete(
    '/:messageId',
    validateAgentId,
    validateSessionId,
    validateMessageId,
    checkAgentAndSessionExist,
    handleValidationErrors,
    async (req: Request, res: Response) => {
      try {
        const { sessionId, messageId } = req.params
        const messageIdNum = parseInt(messageId)

        logger.info(`Deleting message entry: ${messageId} for session: ${sessionId}`)

        // First check if log exists and belongs to session
        const existingMessage = await sessionMessageService.getSessionMessage(messageIdNum)
        if (!existingMessage || existingMessage.session_id !== sessionId) {
          logger.warn(`Log entry ${messageId} not found for session ${sessionId}`)
          return res.status(404).json({
            error: {
              message: 'Message entry not found for this session',
              type: 'not_found',
              code: 'message_not_found'
            }
          })
        }

        const deleted = await sessionMessageService.deleteSessionMessage(messageIdNum)

        if (!deleted) {
          logger.warn(`Log entry not found for deletion: ${messageId}`)
          return res.status(404).json({
            error: {
              message: 'Message entry not found',
              type: 'not_found',
              code: 'message_not_found'
            }
          })
        }

        logger.info(`Log entry deleted successfully: ${messageId}`)
        return res.status(204).send()
      } catch (error: any) {
        logger.error('Error deleting session message:', error)
        return res.status(500).json({
          error: {
            message: 'Failed to delete message entry',
            type: 'internal_error',
            code: 'message_delete_failed'
          }
        })
      }
    }
  )

  return sessionMessagesRouter
}

// Convenience routes (standalone session messages without agent context)
/**
 * @swagger
 * /v1/sessions/{sessionId}/messages:
 *   get:
 *     summary: List message entries for a session (convenience endpoint)
 *     description: Retrieves a paginated list of message entries for the specified session without requiring agent context
 *     tags: [Session Messages]
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
 *         description: Number of message entries to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of message entries to skip
 *     responses:
 *       200:
 *         description: List of message entries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SessionMessageEntity'
 *                 total:
 *                   type: integer
 *                   description: Total number of message entries
 *                 limit:
 *                   type: integer
 *                   description: Number of message entries returned
 *                 offset:
 *                   type: integer
 *                   description: Number of message entries skipped
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
  '/:sessionId/messages',
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

      logger.info(`Listing messages for session: ${sessionId} with limit=${limit}, offset=${offset}`)

      const result = await sessionMessageService.listSessionMessages(sessionId, { limit, offset })

      logger.info(`Retrieved ${result.messages.length} messages (total: ${result.total}) for session: ${sessionId}`)
      return res.json({
        data: result.messages,
        total: result.total,
        limit,
        offset
      })
    } catch (error: any) {
      logger.error('Error listing session messages:', error)
      return res.status(500).json({
        error: {
          message: 'Failed to list message entries',
          type: 'internal_error',
          code: 'message_list_failed'
        }
      })
    }
  }
)

/**
 * @swagger
 * /v1/session-messages/{messageId}:
 *   get:
 *     summary: Get message entry by ID (convenience endpoint)
 *     description: Retrieves a specific message entry without requiring agent or session context
 *     tags: [Session Messages]
 *     parameters:
 *       - in: path
 *         name: messageId
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
 *               $ref: '#/components/schemas/SessionMessageEntity'
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
router.get(
  '/session-messages/:messageId',
  validateMessageId,
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { messageId } = req.params
      const messageIdNum = parseInt(messageId)

      logger.info(`Getting message entry: ${messageId}`)

      const message = await sessionMessageService.getSessionMessage(messageIdNum)

      if (!message) {
        logger.warn(`Log entry not found: ${messageId}`)
        return res.status(404).json({
          error: {
            message: 'Log entry not found',
            type: 'not_found',
            code: 'message_not_found'
          }
        })
      }

      logger.info(`Log entry retrieved successfully: ${messageId}`)
      return res.json(message)
    } catch (error: any) {
      logger.error('Error getting session message:', error)
      return res.status(500).json({
        error: {
          message: 'Failed to get message entry',
          type: 'internal_error',
          code: 'message_get_failed'
        }
      })
    }
  }
)

export { createSessionMessagesRouter, router as sessionMessagesRoutes }
