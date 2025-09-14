import { Request, Response } from 'express'

import { agentService, sessionMessageService, sessionService } from '../../../../services/agents'
import { loggerService } from '../../../../services/LoggerService'

const logger = loggerService.withContext('ApiServerMessagesHandlers')

// Helper function to verify agent and session exist and belong together
const verifyAgentAndSession = async (agentId: string, sessionId: string) => {
  const agentExists = await agentService.agentExists(agentId)
  if (!agentExists) {
    throw { status: 404, code: 'agent_not_found', message: 'Agent not found' }
  }

  const session = await sessionService.getSession(sessionId)
  if (!session) {
    throw { status: 404, code: 'session_not_found', message: 'Session not found' }
  }

  if (session.main_agent_id !== agentId) {
    throw { status: 404, code: 'session_not_found', message: 'Session not found for this agent' }
  }

  return session
}

export const createMessage = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, sessionId } = req.params

    await verifyAgentAndSession(agentId, sessionId)

    const messageData = { ...req.body, session_id: sessionId }

    logger.info(`Creating new message for session: ${sessionId}`)
    logger.debug('Message data:', messageData)

    const message = await sessionMessageService.createSessionMessage(messageData)

    logger.info(`Message created successfully: ${message.id}`)
    return res.status(201).json(message)
  } catch (error: any) {
    if (error.status) {
      return res.status(error.status).json({
        error: {
          message: error.message,
          type: 'not_found',
          code: error.code
        }
      })
    }

    logger.error('Error creating message:', error)
    return res.status(500).json({
      error: {
        message: 'Failed to create message',
        type: 'internal_error',
        code: 'message_creation_failed'
      }
    })
  }
}

export const createBulkMessages = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, sessionId } = req.params

    await verifyAgentAndSession(agentId, sessionId)

    const messagesData = req.body.map((msg: any) => ({ ...msg, session_id: sessionId }))

    logger.info(`Creating ${messagesData.length} messages for session: ${sessionId}`)
    logger.debug('Messages data:', messagesData)

    const messages = await sessionMessageService.bulkCreateSessionMessages(messagesData)

    logger.info(`${messages.length} messages created successfully for session: ${sessionId}`)
    return res.status(201).json(messages)
  } catch (error: any) {
    if (error.status) {
      return res.status(error.status).json({
        error: {
          message: error.message,
          type: 'not_found',
          code: error.code
        }
      })
    }

    logger.error('Error creating bulk messages:', error)
    return res.status(500).json({
      error: {
        message: 'Failed to create messages',
        type: 'internal_error',
        code: 'bulk_message_creation_failed'
      }
    })
  }
}

export const listMessages = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, sessionId } = req.params

    await verifyAgentAndSession(agentId, sessionId)

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
    if (error.status) {
      return res.status(error.status).json({
        error: {
          message: error.message,
          type: 'not_found',
          code: error.code
        }
      })
    }

    logger.error('Error listing messages:', error)
    return res.status(500).json({
      error: {
        message: 'Failed to list messages',
        type: 'internal_error',
        code: 'message_list_failed'
      }
    })
  }
}

export const getMessage = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, sessionId, messageId } = req.params

    await verifyAgentAndSession(agentId, sessionId)

    logger.info(`Getting message: ${messageId} for session: ${sessionId}`)

    const message = await sessionMessageService.getSessionMessage(parseInt(messageId))

    if (!message) {
      logger.warn(`Message not found: ${messageId}`)
      return res.status(404).json({
        error: {
          message: 'Message not found',
          type: 'not_found',
          code: 'message_not_found'
        }
      })
    }

    // Verify message belongs to the session
    if (message.session_id !== sessionId) {
      logger.warn(`Message ${messageId} does not belong to session ${sessionId}`)
      return res.status(404).json({
        error: {
          message: 'Message not found for this session',
          type: 'not_found',
          code: 'message_not_found'
        }
      })
    }

    logger.info(`Message retrieved successfully: ${messageId}`)
    return res.json(message)
  } catch (error: any) {
    if (error.status) {
      return res.status(error.status).json({
        error: {
          message: error.message,
          type: 'not_found',
          code: error.code
        }
      })
    }

    logger.error('Error getting message:', error)
    return res.status(500).json({
      error: {
        message: 'Failed to get message',
        type: 'internal_error',
        code: 'message_get_failed'
      }
    })
  }
}

export const updateMessage = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, sessionId, messageId } = req.params

    await verifyAgentAndSession(agentId, sessionId)

    logger.info(`Updating message: ${messageId} for session: ${sessionId}`)
    logger.debug('Update data:', req.body)

    // First check if message exists and belongs to session
    const existingMessage = await sessionMessageService.getSessionMessage(parseInt(messageId))
    if (!existingMessage || existingMessage.session_id !== sessionId) {
      logger.warn(`Message ${messageId} not found for session ${sessionId}`)
      return res.status(404).json({
        error: {
          message: 'Message not found for this session',
          type: 'not_found',
          code: 'message_not_found'
        }
      })
    }

    const message = await sessionMessageService.updateSessionMessage(parseInt(messageId), req.body)

    if (!message) {
      logger.warn(`Message not found for update: ${messageId}`)
      return res.status(404).json({
        error: {
          message: 'Message not found',
          type: 'not_found',
          code: 'message_not_found'
        }
      })
    }

    logger.info(`Message updated successfully: ${messageId}`)
    return res.json(message)
  } catch (error: any) {
    if (error.status) {
      return res.status(error.status).json({
        error: {
          message: error.message,
          type: 'not_found',
          code: error.code
        }
      })
    }

    logger.error('Error updating message:', error)
    return res.status(500).json({
      error: {
        message: 'Failed to update message',
        type: 'internal_error',
        code: 'message_update_failed'
      }
    })
  }
}

export const deleteMessage = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, sessionId, messageId } = req.params

    await verifyAgentAndSession(agentId, sessionId)

    logger.info(`Deleting message: ${messageId} for session: ${sessionId}`)

    // First check if message exists and belongs to session
    const existingMessage = await sessionMessageService.getSessionMessage(parseInt(messageId))
    if (!existingMessage || existingMessage.session_id !== sessionId) {
      logger.warn(`Message ${messageId} not found for session ${sessionId}`)
      return res.status(404).json({
        error: {
          message: 'Message not found for this session',
          type: 'not_found',
          code: 'message_not_found'
        }
      })
    }

    const deleted = await sessionMessageService.deleteSessionMessage(parseInt(messageId))

    if (!deleted) {
      logger.warn(`Message not found for deletion: ${messageId}`)
      return res.status(404).json({
        error: {
          message: 'Message not found',
          type: 'not_found',
          code: 'message_not_found'
        }
      })
    }

    logger.info(`Message deleted successfully: ${messageId}`)
    return res.status(204).send()
  } catch (error: any) {
    if (error.status) {
      return res.status(error.status).json({
        error: {
          message: error.message,
          type: 'not_found',
          code: error.code
        }
      })
    }

    logger.error('Error deleting message:', error)
    return res.status(500).json({
      error: {
        message: 'Failed to delete message',
        type: 'internal_error',
        code: 'message_delete_failed'
      }
    })
  }
}
