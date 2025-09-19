import { loggerService } from '@logger'
import { sessionMessageService, sessionService } from '@main/services/agents'
import {
  CreateSessionResponse,
  ListAgentSessionsResponse,
  type ReplaceSessionRequest,
  UpdateSessionResponse
} from '@types'
import { Request, Response } from 'express'

import type { ValidationRequest } from '../validators/zodValidator'

const logger = loggerService.withContext('ApiServerSessionsHandlers')

export const createSession = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId } = req.params
    const sessionData = req.body

    logger.info(`Creating new session for agent: ${agentId}`)
    logger.debug('Session data:', sessionData)

    const session = (await sessionService.createSession(agentId, sessionData)) satisfies CreateSessionResponse

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

export const listSessions = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId } = req.params
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0
    const status = req.query.status as any

    logger.info(`Listing sessions for agent: ${agentId} with limit=${limit}, offset=${offset}, status=${status}`)

    const result = await sessionService.listSessions(agentId, { limit, offset })

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

export const getSession = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, sessionId } = req.params
    logger.info(`Getting session: ${sessionId} for agent: ${agentId}`)

    const session = await sessionService.getSession(agentId, sessionId)

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
    logger.info(`Fetching messages for session: ${sessionId}`)
    const { messages } = await sessionMessageService.listSessionMessages(sessionId)

    // Add messages to session
    const sessionWithMessages = {
      ...session,
      messages: messages
    }

    logger.info(`Session retrieved successfully: ${sessionId} with ${messages.length} messages`)
    return res.json(sessionWithMessages)
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

export const updateSession = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, sessionId } = req.params
    logger.info(`Updating session: ${sessionId} for agent: ${agentId}`)
    logger.debug('Update data:', req.body)

    // First check if session exists and belongs to agent
    const existingSession = await sessionService.getSession(agentId, sessionId)
    if (!existingSession || existingSession.agent_id !== agentId) {
      logger.warn(`Session ${sessionId} not found for agent ${agentId}`)
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
    return res.json(session satisfies UpdateSessionResponse)
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

export const patchSession = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, sessionId } = req.params
    logger.info(`Patching session: ${sessionId} for agent: ${agentId}`)
    logger.debug('Patch data:', req.body)

    // First check if session exists and belongs to agent
    const existingSession = await sessionService.getSession(agentId, sessionId)
    if (!existingSession || existingSession.agent_id !== agentId) {
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
    const session = await sessionService.updateSession(agentId, sessionId, updateSession)

    if (!session) {
      logger.warn(`Session not found for patch: ${sessionId}`)
      return res.status(404).json({
        error: {
          message: 'Session not found',
          type: 'not_found',
          code: 'session_not_found'
        }
      })
    }

    logger.info(`Session patched successfully: ${sessionId}`)
    return res.json(session)
  } catch (error: any) {
    logger.error('Error patching session:', error)
    return res.status(500).json({
      error: {
        message: 'Failed to patch session',
        type: 'internal_error',
        code: 'session_patch_failed'
      }
    })
  }
}

export const deleteSession = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, sessionId } = req.params
    logger.info(`Deleting session: ${sessionId} for agent: ${agentId}`)

    // First check if session exists and belongs to agent
    const existingSession = await sessionService.getSession(agentId, sessionId)
    if (!existingSession || existingSession.agent_id !== agentId) {
      logger.warn(`Session ${sessionId} not found for agent ${agentId}`)
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

// Convenience endpoints for sessions without agent context
export const listAllSessions = async (req: Request, res: Response): Promise<Response> => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0
    const status = req.query.status as any

    logger.info(`Listing all sessions with limit=${limit}, offset=${offset}, status=${status}`)

    const result = await sessionService.listSessions(undefined, { limit, offset })

    logger.info(`Retrieved ${result.sessions.length} sessions (total: ${result.total})`)
    return res.json({
      data: result.sessions,
      total: result.total,
      limit,
      offset
    } satisfies ListAgentSessionsResponse)
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
}

export const getSessionById = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { sessionId } = req.params
    logger.info(`Getting session: ${sessionId}`)

    const session = await sessionService.getSessionById(sessionId)

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
}
