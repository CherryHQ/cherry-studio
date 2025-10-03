import { loggerService } from '@logger'
import { AgentModelValidationError, sessionMessageService, sessionService } from '@main/services/agents'
import { ListAgentSessionsResponse, type ReplaceSessionRequest, UpdateSessionResponse } from '@types'
import { Request, Response } from 'express'

import type { ValidationRequest } from '../validators/zodValidator'

const logger = loggerService.withContext('ApiServerSessionsHandlers')

const modelValidationErrorBody = (error: AgentModelValidationError) => ({
  error: {
    message: `Invalid ${error.context.field}: ${error.detail.message}`,
    type: 'invalid_request_error',
    code: error.detail.code
  }
})

export const createSession = async (req: Request, res: Response): Promise<Response> => {
  const { agentId } = req.params
  try {
    const sessionData = req.body

    logger.debug('Creating new session', { agentId })
    logger.debug('Session payload', { sessionData })

    const session = await sessionService.createSession(agentId, sessionData)

    logger.info('Session created', { agentId, sessionId: session?.id })
    return res.status(201).json(session)
  } catch (error: any) {
    if (error instanceof AgentModelValidationError) {
      logger.warn('Session model validation error during create', {
        agentId,
        agentType: error.context.agentType,
        field: error.context.field,
        model: error.context.model,
        detail: error.detail
      })
      return res.status(400).json(modelValidationErrorBody(error))
    }

    logger.error('Error creating session', { error, agentId })
    return res.status(500).json({
      error: {
        message: `Failed to create session: ${error.message}`,
        type: 'internal_error',
        code: 'session_creation_failed'
      }
    })
  }
}

export const listSessions = async (req: Request, res: Response): Promise<Response> => {
  const { agentId } = req.params
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0
    const status = req.query.status as any

    logger.debug('Listing agent sessions', { agentId, limit, offset, status })

    const result = await sessionService.listSessions(agentId, { limit, offset })

    logger.info('Agent sessions listed', {
      agentId,
      returned: result.sessions.length,
      total: result.total,
      limit,
      offset
    })
    return res.json({
      data: result.sessions,
      total: result.total,
      limit,
      offset
    })
  } catch (error: any) {
    logger.error('Error listing sessions', { error, agentId })
    return res.status(500).json({
      error: {
        message: 'Failed to list sessions',
        type: 'internal_error',
        code: 'session_list_failed'
      }
    })
  }
}

export const getSession = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, sessionId } = req.params
    logger.debug('Getting session', { agentId, sessionId })

    const session = await sessionService.getSession(agentId, sessionId)

    if (!session) {
      logger.warn('Session not found', { agentId, sessionId })
      return res.status(404).json({
        error: {
          message: 'Session not found',
          type: 'not_found',
          code: 'session_not_found'
        }
      })
    }

    // // Verify session belongs to the agent
    //   logger.warn(`Session ${sessionId} does not belong to agent ${agentId}`)
    //   return res.status(404).json({
    //     error: {
    //       message: 'Session not found for this agent',
    //       type: 'not_found',
    //       code: 'session_not_found'
    //     }
    //   })
    // }

    // Fetch session messages
    logger.debug('Fetching session messages', { sessionId })
    const { messages } = await sessionMessageService.listSessionMessages(sessionId)

    // Add messages to session
    const sessionWithMessages = {
      ...session,
      messages: messages
    }

    logger.info('Session retrieved', { agentId, sessionId, messageCount: messages.length })
    return res.json(sessionWithMessages)
  } catch (error: any) {
    logger.error('Error getting session', { error, agentId: req.params.agentId, sessionId: req.params.sessionId })
    return res.status(500).json({
      error: {
        message: 'Failed to get session',
        type: 'internal_error',
        code: 'session_get_failed'
      }
    })
  }
}

export const updateSession = async (req: Request, res: Response): Promise<Response> => {
  const { agentId, sessionId } = req.params
  try {
    logger.debug('Updating session', { agentId, sessionId })
    logger.debug('Replace payload', { body: req.body })

    // First check if session exists and belongs to agent
    const existingSession = await sessionService.getSession(agentId, sessionId)
    if (!existingSession || existingSession.agent_id !== agentId) {
      logger.warn('Session not found for update', { agentId, sessionId })
      return res.status(404).json({
        error: {
          message: 'Session not found for this agent',
          type: 'not_found',
          code: 'session_not_found'
        }
      })
    }

    const { validatedBody } = req as ValidationRequest
    const replacePayload = (validatedBody ?? {}) as ReplaceSessionRequest

    const session = await sessionService.updateSession(agentId, sessionId, replacePayload)

    if (!session) {
      logger.warn('Session missing during update', { agentId, sessionId })
      return res.status(404).json({
        error: {
          message: 'Session not found',
          type: 'not_found',
          code: 'session_not_found'
        }
      })
    }

    logger.info('Session updated', { agentId, sessionId })
    return res.json(session satisfies UpdateSessionResponse)
  } catch (error: any) {
    if (error instanceof AgentModelValidationError) {
      logger.warn('Session model validation error during update', {
        agentId,
        sessionId,
        agentType: error.context.agentType,
        field: error.context.field,
        model: error.context.model,
        detail: error.detail
      })
      return res.status(400).json(modelValidationErrorBody(error))
    }

    logger.error('Error updating session', { error, agentId, sessionId })
    return res.status(500).json({
      error: {
        message: `Failed to update session: ${error.message}`,
        type: 'internal_error',
        code: 'session_update_failed'
      }
    })
  }
}

export const patchSession = async (req: Request, res: Response): Promise<Response> => {
  const { agentId, sessionId } = req.params
  try {
    logger.debug('Patching session', { agentId, sessionId })
    logger.debug('Patch payload', { body: req.body })

    // First check if session exists and belongs to agent
    const existingSession = await sessionService.getSession(agentId, sessionId)
    if (!existingSession || existingSession.agent_id !== agentId) {
      logger.warn('Session not found for patch', { agentId, sessionId })
      return res.status(404).json({
        error: {
          message: 'Session not found for this agent',
          type: 'not_found',
          code: 'session_not_found'
        }
      })
    }

    const updateSession = { ...existingSession, ...req.body }
    const session = await sessionService.updateSession(agentId, sessionId, updateSession)

    if (!session) {
      logger.warn('Session missing while patching', { agentId, sessionId })
      return res.status(404).json({
        error: {
          message: 'Session not found',
          type: 'not_found',
          code: 'session_not_found'
        }
      })
    }

    logger.info('Session patched', { agentId, sessionId })
    return res.json(session)
  } catch (error: any) {
    if (error instanceof AgentModelValidationError) {
      logger.warn('Session model validation error during patch', {
        agentId,
        sessionId,
        agentType: error.context.agentType,
        field: error.context.field,
        model: error.context.model,
        detail: error.detail
      })
      return res.status(400).json(modelValidationErrorBody(error))
    }

    logger.error('Error patching session', { error, agentId, sessionId })
    return res.status(500).json({
      error: {
        message: `Failed to patch session, ${error.message}`,
        type: 'internal_error',
        code: 'session_patch_failed'
      }
    })
  }
}

export const deleteSession = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, sessionId } = req.params
    logger.debug('Deleting session', { agentId, sessionId })

    // First check if session exists and belongs to agent
    const existingSession = await sessionService.getSession(agentId, sessionId)
    if (!existingSession || existingSession.agent_id !== agentId) {
      logger.warn('Session not found for deletion', { agentId, sessionId })
      return res.status(404).json({
        error: {
          message: 'Session not found for this agent',
          type: 'not_found',
          code: 'session_not_found'
        }
      })
    }

    const deleted = await sessionService.deleteSession(agentId, sessionId)

    if (!deleted) {
      logger.warn('Session missing during delete', { agentId, sessionId })
      return res.status(404).json({
        error: {
          message: 'Session not found',
          type: 'not_found',
          code: 'session_not_found'
        }
      })
    }

    logger.info('Session deleted', { agentId, sessionId })

    const { total } = await sessionService.listSessions(agentId, { limit: 1 })

    if (total === 0) {
      logger.info('No remaining sessions, creating default', { agentId })
      try {
        const fallbackSession = await sessionService.createSession(agentId, {})
        logger.info('Default session created after delete', {
          agentId,
          sessionId: fallbackSession?.id
        })
      } catch (recoveryError: any) {
        logger.error('Failed to recreate session after deleting last session', {
          agentId,
          error: recoveryError
        })
        return res.status(500).json({
          error: {
            message: `Failed to recreate session after deletion: ${recoveryError.message}`,
            type: 'internal_error',
            code: 'session_recovery_failed'
          }
        })
      }
    }

    return res.status(204).send()
  } catch (error: any) {
    logger.error('Error deleting session', { error, agentId: req.params.agentId, sessionId: req.params.sessionId })
    return res.status(500).json({
      error: {
        message: 'Failed to delete session',
        type: 'internal_error',
        code: 'session_delete_failed'
      }
    })
  }
}

// Convenience endpoints for sessions without agent context
export const listAllSessions = async (req: Request, res: Response): Promise<Response> => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0
    const status = req.query.status as any

    logger.debug('Listing all sessions', { limit, offset, status })

    const result = await sessionService.listSessions(undefined, { limit, offset })

    logger.info('Sessions listed', {
      returned: result.sessions.length,
      total: result.total,
      limit,
      offset
    })
    return res.json({
      data: result.sessions,
      total: result.total,
      limit,
      offset
    } satisfies ListAgentSessionsResponse)
  } catch (error: any) {
    logger.error('Error listing all sessions', { error })
    return res.status(500).json({
      error: {
        message: 'Failed to list sessions',
        type: 'internal_error',
        code: 'session_list_failed'
      }
    })
  }
}
