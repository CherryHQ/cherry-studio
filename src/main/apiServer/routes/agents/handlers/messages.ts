import { loggerService } from '@logger'
import { Request, Response } from 'express'

import { agentService, sessionMessageService, sessionService } from '../../../../services/agents'

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

  if (session.agent_id !== agentId) {
    throw { status: 404, code: 'session_not_found', message: 'Session not found for this agent' }
  }

  return session
}

export const createMessage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { agentId, sessionId } = req.params

    const session = await verifyAgentAndSession(agentId, sessionId)

    const messageData = req.body

    logger.info(`Creating streaming message for session: ${sessionId}`)
    logger.debug('Streaming message data:', messageData)

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control')

    // Send initial connection event
    res.write('data: {"type":"start"}\n\n')

    const messageStream = sessionMessageService.createSessionMessage(session, messageData)

    // Track if the response has ended to prevent further writes
    let responseEnded = false

    // Handle client disconnect
    req.on('close', () => {
      logger.info(`Client disconnected from streaming message for session: ${sessionId}`)
      responseEnded = true
      messageStream.removeAllListeners()
    })

    // Handle stream events
    messageStream.on('data', (event: any) => {
      if (responseEnded) return

      try {
        switch (event.type) {
          case 'chunk':
            // Format UIMessageChunk as SSE event following AI SDK protocol
            res.write(`data: ${JSON.stringify(event.chunk)}\n\n`)
            break

          case 'error': {
            // Send error as AI SDK error chunk
            const errorChunk = {
              type: 'error',
              errorText: event.error?.message || 'Stream processing error'
            }
            res.write(`data: ${JSON.stringify(errorChunk)}\n\n`)
            logger.error(`Streaming message error for session: ${sessionId}:`, event.error)
            responseEnded = true
            res.write('data: [DONE]\n\n')
            res.end()
            break
          }

          case 'complete':
            // Send completion marker following AI SDK protocol
            logger.info(`Streaming message completed for session: ${sessionId}`)
            responseEnded = true
            res.write('data: [DONE]\n\n')
            res.end()
            break

          default:
            // Handle other event types as generic data
            res.write(`data: ${JSON.stringify(event)}\n\n`)
            break
        }
      } catch (writeError) {
        logger.error('Error writing to SSE stream:', { error: writeError })
        if (!responseEnded) {
          responseEnded = true
          res.end()
        }
      }
    })

    // Handle stream errors
    messageStream.on('error', (error: Error) => {
      if (responseEnded) return

      logger.error(`Stream error for session: ${sessionId}:`, { error })
      try {
        res.write(
          `data: ${JSON.stringify({
            type: 'error',
            error: {
              message: error.message || 'Stream processing error',
              type: 'stream_error',
              code: 'stream_processing_failed'
            }
          })}\n\n`
        )
      } catch (writeError) {
        logger.error('Error writing error to SSE stream:', { error: writeError })
      }
      responseEnded = true
      res.end()
    })

    // Set a timeout to prevent hanging indefinitely
    const timeout = setTimeout(
      () => {
        if (!responseEnded) {
          logger.error(`Streaming message timeout for session: ${sessionId}`)
          try {
            res.write(
              `data: ${JSON.stringify({
                type: 'error',
                error: {
                  message: 'Stream timeout',
                  type: 'timeout_error',
                  code: 'stream_timeout'
                }
              })}\n\n`
            )
          } catch (writeError) {
            logger.error('Error writing timeout to SSE stream:', { error: writeError })
          }
          responseEnded = true
          res.end()
        }
      },
      5 * 60 * 1000
    ) // 5 minutes timeout

    // Clear timeout when response ends
    res.on('close', () => clearTimeout(timeout))
    res.on('finish', () => clearTimeout(timeout))
  } catch (error: any) {
    logger.error('Error in streaming message handler:', error)

    // Send error as SSE if possible
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
    }

    try {
      const errorResponse = {
        type: 'error',
        error: {
          message: error.status ? error.message : 'Failed to create streaming message',
          type: error.status ? 'not_found' : 'internal_error',
          code: error.status ? error.code : 'stream_creation_failed'
        }
      }

      res.write(`data: ${JSON.stringify(errorResponse)}\n\n`)
    } catch (writeError) {
      logger.error('Error writing initial error to SSE stream:', { error: writeError })
    }

    res.end()
  }
}
