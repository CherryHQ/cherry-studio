import { loggerService } from '@logger'
import { MESSAGE_STREAM_TIMEOUT_MS } from '@main/apiServer/config/timeouts'
import { createStreamAbortController, STREAM_TIMEOUT_REASON } from '@main/apiServer/utils/createStreamAbortController'
import { agentService, sessionMessageService, sessionService } from '@main/services/agents'
import type { Request, Response } from 'express'

const logger = loggerService.withContext('ApiServerMessagesHandlers')

// Helper function to verify agent and session exist and belong together
const verifyAgentAndSession = async (agentId: string, sessionId: string) => {
  const agentExists = await agentService.agentExists(agentId)
  if (!agentExists) {
    throw { status: 404, code: 'agent_not_found', message: 'Agent not found' }
  }

  const session = await sessionService.getSession(agentId, sessionId)
  if (!session) {
    throw { status: 404, code: 'session_not_found', message: 'Session not found' }
  }

  if (session.agent_id !== agentId) {
    throw { status: 404, code: 'session_not_found', message: 'Session not found for this agent' }
  }

  return session
}

export const createMessage = async (req: Request, res: Response): Promise<void> => {
  let clearAbortTimeout: (() => void) | undefined

  try {
    const { agentId, sessionId } = req.params

    const session = await verifyAgentAndSession(agentId, sessionId)

    const messageData = req.body

    logger.info('Creating streaming message', { agentId, sessionId })
    logger.debug('Streaming message payload', { messageData })

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control')

    const {
      abortController,
      registerAbortHandler,
      clearAbortTimeout: helperClearAbortTimeout
    } = createStreamAbortController({
      timeoutMs: MESSAGE_STREAM_TIMEOUT_MS
    })
    clearAbortTimeout = helperClearAbortTimeout
    const { stream, completion } = await sessionMessageService.createSessionMessage(
      session,
      messageData,
      abortController
    )
    const reader = stream.getReader()

    // Track stream lifecycle so we keep the SSE connection open until persistence finishes
    let responseEnded = false
    let streamFinished = false

    const cleanupAbortTimeout = () => {
      clearAbortTimeout?.()
    }

    const finalizeResponse = () => {
      if (responseEnded) {
        return
      }

      if (!streamFinished) {
        return
      }

      responseEnded = true
      cleanupAbortTimeout()
      try {
        // res.write('data: {"type":"finish"}\n\n')
        res.write('data: [DONE]\n\n')
      } catch (writeError) {
        logger.error('Error writing final sentinel to SSE stream', { error: writeError as Error })
      }
      res.end()
    }

    /**
     * Client Disconnect Detection for Server-Sent Events (SSE)
     *
     * We monitor multiple HTTP events to reliably detect when a client disconnects
     * from the streaming response. This is crucial for:
     * - Aborting long-running Claude Code processes
     * - Cleaning up resources and preventing memory leaks
     * - Avoiding orphaned processes
     *
     * Event Priority & Behavior:
     * 1. res.on('close') - Most common for SSE client disconnects (browser tab close, curl Ctrl+C)
     * 2. req.on('aborted') - Explicit request abortion
     * 3. req.on('close') - Request object closure (less common with SSE)
     *
     * When any disconnect event fires, we:
     * - Abort the Claude Code SDK process via abortController
     * - Clean up event listeners to prevent memory leaks
     * - Mark the response as ended to prevent further writes
     */
    registerAbortHandler((abortReason) => {
      cleanupAbortTimeout()

      if (responseEnded) return

      responseEnded = true

      if (abortReason === STREAM_TIMEOUT_REASON) {
        logger.error('Streaming message timeout', { agentId, sessionId })
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
          logger.error('Error writing timeout to SSE stream', { error: writeError })
        }
      } else if (abortReason === 'Client disconnected') {
        logger.info('Streaming client disconnected', { agentId, sessionId })
      } else {
        logger.warn('Streaming aborted', { agentId, sessionId, reason: abortReason })
      }

      reader.cancel(abortReason ?? 'stream aborted').catch(() => {})

      if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
      }

      if (!res.writableEnded) {
        res.end()
      }
    })

    const handleDisconnect = () => {
      if (abortController.signal.aborted) return
      abortController.abort('Client disconnected')
    }

    req.on('close', handleDisconnect)
    req.on('aborted', handleDisconnect)
    res.on('close', handleDisconnect)

    const pumpStream = async () => {
      try {
        while (!responseEnded) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }

          res.write(`data: ${JSON.stringify(value)}\n\n`)
        }

        streamFinished = true
        finalizeResponse()
      } catch (error) {
        if (responseEnded) return
        logger.error('Error reading agent stream', { error })
        try {
          res.write(
            `data: ${JSON.stringify({
              type: 'error',
              error: {
                message: (error as Error).message || 'Stream processing error',
                type: 'stream_error',
                code: 'stream_processing_failed'
              }
            })}\n\n`
          )
        } catch (writeError) {
          logger.error('Error writing stream error to SSE', { error: writeError })
        }
        responseEnded = true
        cleanupAbortTimeout()
        res.end()
      }
    }

    pumpStream().catch((error) => {
      logger.error('Pump stream failure', { error })
    })

    completion
      .then(() => {
        streamFinished = true
        finalizeResponse()
      })
      .catch((error) => {
        if (responseEnded) return
        logger.error('Streaming message error', { agentId, sessionId, error })
        try {
          res.write(
            `data: ${JSON.stringify({
              type: 'error',
              error: {
                message: (error as { message?: string })?.message || 'Stream processing error',
                type: 'stream_error',
                code: 'stream_processing_failed'
              }
            })}\n\n`
          )
        } catch (writeError) {
          logger.error('Error writing completion error to SSE stream', { error: writeError })
        }
        responseEnded = true
        cleanupAbortTimeout()
        res.end()
      })
    // Clear timeout when response ends
    res.on('close', cleanupAbortTimeout)
    res.on('finish', cleanupAbortTimeout)
  } catch (error: any) {
    clearAbortTimeout?.()
    logger.error('Error in streaming message handler', {
      error,
      agentId: req.params.agentId,
      sessionId: req.params.sessionId
    })

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
      logger.error('Error writing initial error to SSE stream', { error: writeError })
    }

    res.end()
  }
}

export const deleteMessage = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, sessionId, messageId: messageIdParam } = req.params
    const messageId = Number(messageIdParam)

    await verifyAgentAndSession(agentId, sessionId)

    const deleted = await sessionMessageService.deleteSessionMessage(sessionId, messageId)

    if (!deleted) {
      logger.warn('Session message not found', { agentId, sessionId, messageId })
      return res.status(404).json({
        error: {
          message: 'Message not found for this session',
          type: 'not_found',
          code: 'session_message_not_found'
        }
      })
    }

    logger.info('Session message deleted', { agentId, sessionId, messageId })
    return res.status(204).send()
  } catch (error: any) {
    if (error?.status === 404) {
      logger.warn('Delete message failed - missing resource', {
        agentId: req.params.agentId,
        sessionId: req.params.sessionId,
        messageId: req.params.messageId,
        error
      })
      return res.status(404).json({
        error: {
          message: error.message,
          type: 'not_found',
          code: error.code ?? 'session_message_not_found'
        }
      })
    }

    logger.error('Error deleting session message', {
      error,
      agentId: req.params.agentId,
      sessionId: req.params.sessionId,
      messageId: Number(req.params.messageId)
    })
    return res.status(500).json({
      error: {
        message: 'Failed to delete session message',
        type: 'internal_error',
        code: 'session_message_delete_failed'
      }
    })
  }
}
